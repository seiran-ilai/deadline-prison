import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { normalizeStatus, SESSION_STATUS_LABEL } from './warden/constants'

// 「服刑紀錄」分頁:只記「以犯人身分下場」的場次,一律「新→舊」排序(依場次日期,缺則 created_at)。
//   犯人/獄卒 — 我以犯人身分參加的每一場:場次資訊 + 專屬獄卒 + 我挑的目標稿名 + 收到的探監。
//   典獄長(warden)— 額外多「全監場次總覽」:場次資訊 + 狀態 + 該場犯人數 / 獄卒數。
// 獄卒身分的場次在獨立的「看守紀錄」分頁(GuardRecordsPage,僅 guard/warden 可見)。
// 全部「分開查再 JS 合併」,不用巢狀 select。

const SESS_COLS = 'id, title, session_date, total_rounds, status, created_at'
const dateKey = (s) => new Date(s?.session_date ?? s?.created_at ?? 0).getTime()
const byDateDesc = (a, b) => dateKey(b.session) - dateKey(a.session)
const sessionDate = (s) => (s?.session_date ? String(s.session_date).slice(0, 10) : '未定')
// 場次五態標籤(相容過渡期舊值 open/closed,統一走 normalizeStatus)
const statusLabel = (s) => SESSION_STATUS_LABEL[normalizeStatus(s)] ?? '已結束'
const roleInSessionLabel = (r) => (r === 'guard' ? '獄卒' : '犯人')
const guardName = (p) => p?.game_name ?? p?.display_name ?? '（未知）'

// 犯人視角:我「以犯人身分」參加的每一場 + 該場專屬獄卒 + 我挑的目標稿名
// (獄卒身分的場次改記在「看守紀錄」分頁,這裡過濾掉)
async function loadMember(userId) {
  const { data: siAll } = await supabase.from('session_inmates')
    .select('id, session_id, role_in_session').eq('member_id', userId)
  const si = (siAll ?? []).filter(r => r.role_in_session !== 'guard')
  if (!si.length) return []
  const sessionIds = [...new Set(si.map(r => r.session_id))]
  const siIds = si.map(r => r.id)

  const { data: sess } = await supabase.from('sessions').select(SESS_COLS).in('id', sessionIds)
  const sessById = {}; for (const s of sess ?? []) sessById[s.id] = s

  // 那場我的專屬獄卒(inmate_guards → profiles)
  const { data: igs } = await supabase.from('inmate_guards')
    .select('session_inmate_id, guard_id').in('session_inmate_id', siIds)
  const guardIds = [...new Set((igs ?? []).map(g => g.guard_id))]
  const guardById = {}
  if (guardIds.length) {
    const { data: gp } = await supabase.from('profiles')
      .select('id, game_name, display_name').in('id', guardIds)
    for (const p of gp ?? []) guardById[p.id] = p
  }
  const guardsBySi = {}
  for (const g of igs ?? []) (guardsBySi[g.session_inmate_id] ??= []).push(guardById[g.guard_id])

  // 我挑的目標稿名(session_goals → manuscripts;看自己的,私密稿也讀得到)
  const { data: goals } = await supabase.from('session_goals')
    .select('session_inmate_id, manuscript_id').in('session_inmate_id', siIds)
  const msIds = [...new Set((goals ?? []).map(g => g.manuscript_id))]
  const titleById = {}
  if (msIds.length) {
    const { data: ms } = await supabase.from('manuscripts').select('id, title').in('id', msIds)
    for (const m of ms ?? []) titleById[m.id] = m.title
  }
  const goalsBySi = {}
  for (const g of goals ?? [])
    (goalsBySi[g.session_inmate_id] ??= []).push(titleById[g.manuscript_id] ?? '（稿件已不存在）')

  // 收到的探監(visits inmate_id=我,本場;新→舊;含指定獄卒)
  const { data: visits } = await supabase.from('visits')
    .select('id, session_id, guard_id, visitor_name, message, created_at')
    .eq('inmate_id', userId).in('session_id', sessionIds).order('created_at', { ascending: false })
  // 探監指定獄卒的顯示名(與專屬獄卒共用 guardById 名字快取)
  const vGuardIds = [...new Set((visits ?? []).map(v => v.guard_id).filter(Boolean).filter(id => !guardById[id]))]
  if (vGuardIds.length) {
    const { data: vgp } = await supabase.from('profiles')
      .select('id, game_name, display_name').in('id', vGuardIds)
    for (const p of vgp ?? []) guardById[p.id] = p
  }
  const visitsBySession = {}
  for (const v of visits ?? [])
    (visitsBySession[v.session_id] ??= []).push({ ...v, guard_name: v.guard_id ? guardName(guardById[v.guard_id]) : null })

  return si.map(r => ({
    key: r.id,
    session: sessById[r.session_id],
    roleInSession: r.role_in_session,
    guards: (guardsBySi[r.id] ?? []).filter(Boolean),
    goalTitles: goalsBySi[r.id] ?? [],
    visits: visitsBySession[r.session_id] ?? [],
  })).filter(x => x.session).sort(byDateDesc)
}

// 典獄長視角:全監所有場次 + 該場犯人數 / 獄卒數
async function loadWarden() {
  const { data: sess } = await supabase.from('sessions').select(SESS_COLS)
  if (!sess || !sess.length) return []
  const { data: si } = await supabase.from('session_inmates').select('session_id, role_in_session')
  const countBySession = {}
  for (const r of si ?? []) {
    const c = (countBySession[r.session_id] ??= { inmates: 0, guards: 0 })
    if (r.role_in_session === 'guard') c.guards++; else c.inmates++
  }
  return sess.map(s => ({
    key: s.id,
    session: s,
    inmates: countBySession[s.id]?.inmates ?? 0,
    guards: countBySession[s.id]?.guards ?? 0,
  })).sort(byDateDesc)
}

function RecHead({ rec, showRole }) {
  const s = rec.session
  return (
    <div className="rec-head">
      <strong className="rec-title">{s.title}</strong>
      <span className="rec-meta mono">{sessionDate(s)}</span>
      <span className="rec-meta">{s.total_rounds ?? '—'} 輪</span>
      {showRole && (
        <span className={`role-tag ${rec.roleInSession === 'guard' ? 'guard' : 'member'}`}>
          {roleInSessionLabel(rec.roleInSession)}
        </span>
      )}
      <span className="spacer" />
      <span className={`tag tag-pill rec-status ${normalizeStatus(s) === 'ended' ? 'ended' : 'open'}`}>{statusLabel(s)}</span>
    </div>
  )
}

// 服刑時數估算:輪數 × 25 分,換算「X 小時 Y 分」。明確為估算,非實際工時。
function fmtRounds(rounds) {
  const mins = (rounds ?? 0) * 25
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`
}

export default function RecordsPage({ userId, role }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [myRows, setMyRows] = useState([])        // warden 專用:自己親自參與的場次(與全監總覽分開)
  const [summary, setSummary] = useState(null)    // my_record_summary 結果
  const [topGuards, setTopGuards] = useState([])  // my_top_guards 結果(並列最高)
  const [visitLog, setVisitLog] = useState(null)  // 過去廣播紀錄 modal:null=關閉,{loading, rows}

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (role === 'warden') {
        // 典獄長:全監總覽 + 自己的參與紀錄分開載(總覽是全場次,不代表本人參加過)
        const [all, mine] = await Promise.all([loadWarden(), loadMember(userId)])
        if (alive) { setRows(all); setMyRows(mine); setLoading(false) }
        return
      }
      // 獄卒與犯人同視角:服刑紀錄只列「以犯人身分」下場的場次(看守場次在「看守紀錄」分頁)
      const result = await loadMember(userId)
      if (alive) { setRows(result); setLoading(false) }
    })()
    return () => { alive = false }
  }, [userId, role])

  // 過去廣播紀錄(收到的全部探監,跨場次新→舊;點「收到探監」統計卡開啟)
  async function openVisitLog() {
    setVisitLog({ loading: true, rows: [] })
    const { data: vs } = await supabase.from('visits')
      .select('id, session_id, guard_id, visitor_name, message, created_at')
      .eq('inmate_id', userId).order('created_at', { ascending: false })
    const sessIds = [...new Set((vs ?? []).map(v => v.session_id))]
    const sessById = {}
    if (sessIds.length) {
      const { data: ss } = await supabase.from('sessions').select('id, title, session_date').in('id', sessIds)
      for (const s of ss ?? []) sessById[s.id] = s
    }
    const gIds = [...new Set((vs ?? []).map(v => v.guard_id).filter(Boolean))]
    const gById = {}
    if (gIds.length) {
      const { data: gp } = await supabase.from('profiles').select('id, game_name, display_name').in('id', gIds)
      for (const p of gp ?? []) gById[p.id] = p
    }
    setVisitLog({
      loading: false,
      rows: (vs ?? []).map(v => ({
        ...v,
        session: sessById[v.session_id],
        guard_name: v.guard_id ? guardName(gById[v.guard_id]) : null,
      })),
    })
  }

  // 個人統整(security definer RPC;回傳可能是單列或單元素陣列,兩種都接)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [{ data: sum }, { data: tg }] = await Promise.all([
        supabase.rpc('my_record_summary'),
        supabase.rpc('my_top_guards'),
      ])
      if (!alive) return
      setSummary(Array.isArray(sum) ? (sum[0] ?? null) : (sum ?? null))
      setTopGuards(tg ?? [])
    })()
    return () => { alive = false }
  }, [userId, role])

  return (
    <div className="records-page">
      <h3>服刑紀錄</h3>

      {/* 個人統整(數字卡) */}
      {summary && (
        <div className="rec-summary">
          <div className="rec-stat">
            <div className="rec-stat-num">{summary.intake_count ?? 0}</div>
            <div className="rec-stat-lbl">入監次數</div>
          </div>
          <div className="rec-stat">
            <div className="rec-stat-num" title="依場次規劃輪數估算，非實際工時">{fmtRounds(summary.total_rounds)}</div>
            <div className="rec-stat-lbl">累計服刑時數（估算）</div>
          </div>
          {/* 點擊開「過去廣播紀錄」modal(跨場次全部探監) */}
          <button type="button" className="rec-stat rec-stat-btn" onClick={openVisitLog} title="點擊查看過去廣播紀錄">
            <div className="rec-stat-num">{summary.visits_received ?? 0}</div>
            <div className="rec-stat-lbl">收到探監 ▸</div>
          </button>
        </div>
      )}
      {role === 'member' && (
        <p className="rec-topguards">
          最常看守你的獄卒：
          {topGuards.length === 0
            ? ' —'
            : ` ${topGuards.map(g => g.guard_name).join('、')}（各 ${topGuards[0]?.times ?? 0} 次）`}
        </p>
      )}

      {(() => {
        // 犯人視角的紀錄卡(典獄長「我的參與紀錄」區共用同一張卡)
        const memberCard = (rec) => (
          <div key={rec.key} className="rec-card">
            <RecHead rec={rec} showRole={true} />
            <div className="rec-body">
              <div className="rec-row">
                <span className="rec-k">專屬獄卒</span>
                <span className="rec-v">{rec.guards.length ? rec.guards.map(guardName).join('、') : '無'}</span>
              </div>
              <div className="rec-row">
                <span className="rec-k">本場目標</span>
                <span className="rec-v">{rec.goalTitles.length ? rec.goalTitles.join('、') : '未挑稿'}</span>
              </div>
              <div className="rec-row">
                <span className="rec-k">收到的探監</span>
                <span className="rec-v">
                  {rec.visits.length === 0
                    ? <span className="faint">本場無人探監</span>
                    : <span className="rec-visits">
                        {rec.visits.map(v => (
                          <span key={v.id} className="rec-visit">
                            💌 {v.visitor_name}:{v.message}
                            {v.guard_name && <span className="faint">（🛡 {v.guard_name}）</span>}
                          </span>
                        ))}
                      </span>}
                </span>
              </div>
            </div>
          </div>
        )

        if (loading) return <p className="empty">讀取服刑紀錄中…</p>
        if (role === 'warden') return (
          <>
            {/* 我的參與紀錄:只列我真的在場(session_inmates)的場次 */}
            <h4 className="rec-sec">我的參與紀錄</h4>
            {myRows.length === 0
              ? <p className="empty">你還沒有親自下場的服刑紀錄</p>
              : myRows.map(memberCard)}
            {/* 全監場次總覽:所有場次的營運視角,非個人參與紀錄 */}
            <h4 className="rec-sec">全監場次總覽</h4>
            {rows.length === 0 ? <p className="empty">目前沒有任何場次</p> : rows.map(rec => (
              <div key={rec.key} className="rec-card">
                <RecHead rec={rec} showRole={false} />
                <div className="rec-body">
                  <div className="rec-row"><span className="rec-k">犯人</span><span className="rec-v">{rec.inmates} 人</span></div>
                  <div className="rec-row"><span className="rec-k">獄卒</span><span className="rec-v">{rec.guards} 人</span></div>
                </div>
              </div>
            ))}
          </>
        )
        if (rows.length === 0) return <p className="empty">你還沒有任何服刑紀錄</p>
        return rows.map(memberCard)
      })()}

      {/* 過去廣播紀錄 modal:收到的全部探監(跨場次,新→舊) */}
      {visitLog && (
        <div className="admin-modal-bg" onClick={() => setVisitLog(null)}>
          <div className="admin-modal visitlog-modal" onClick={e => e.stopPropagation()}>
            <div className="goal-modal-head">
              <h3>收到的探監廣播</h3>
              <button className="goal-modal-x" onClick={() => setVisitLog(null)}>✕</button>
            </div>
            {visitLog.loading ? <p className="empty">讀取廣播紀錄中…</p>
              : visitLog.rows.length === 0 ? <p className="empty">還沒有收到任何探監廣播</p>
                : (
                  <div className="visit-list">
                    {visitLog.rows.map(v => (
                      <div key={v.id} className="visit-row">
                        <div className="visit-text">
                          <span className="visit-meta">{String(v.created_at).slice(0, 10)} · {v.session?.title ?? '（場次已刪除）'}</span>
                          <span className="visit-who">💌 {v.visitor_name}</span>
                          <span className="visit-body">「{v.message}」</span>
                          {v.guard_name && <span className="visit-guard">🛡 指定獄卒：{v.guard_name}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
          </div>
        </div>
      )}
    </div>
  )
}
