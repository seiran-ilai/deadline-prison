import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

// 「服刑紀錄」分頁:依登入者角色顯示不同內容,一律「新→舊」排序(依場次日期,缺則 created_at)。
//   犯人(member)— 我參加過的每一場:場次資訊 + 本場身分 + 那場我的專屬獄卒 + 我挑的目標稿名 + 探監(預留)。
//   獄卒(guard) — 我參加過的每一場:場次資訊 + 本場身分 + 那場我看守了哪些犯人。
//   典獄長(warden)— 全監所有場次總覽:場次資訊 + 狀態 + 該場犯人數 / 獄卒數。
// 全部「分開查再 JS 合併」,不用巢狀 select。

const SESS_COLS = 'id, title, session_date, total_rounds, status, created_at'
const dateKey = (s) => new Date(s?.session_date ?? s?.created_at ?? 0).getTime()
const byDateDesc = (a, b) => dateKey(b.session) - dateKey(a.session)
const sessionDate = (s) => (s?.session_date ? String(s.session_date).slice(0, 10) : '未定')
const statusLabel = (s) => (s?.status === 'open' ? '進行中' : '已結束')
const roleInSessionLabel = (r) => (r === 'guard' ? '獄卒' : '犯人')
const guardName = (p) => p?.game_name ?? p?.display_name ?? '（未知）'

// 犯人視角:我參加過的每一場 + 該場專屬獄卒 + 我挑的目標稿名
async function loadMember(userId) {
  const { data: si } = await supabase.from('session_inmates')
    .select('id, session_id, role_in_session').eq('member_id', userId)
  if (!si || !si.length) return []
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

  // 收到的探監(visits inmate_id=我,本場;新→舊)
  const { data: visits } = await supabase.from('visits')
    .select('id, session_id, visitor_name, message, created_at')
    .eq('inmate_id', userId).in('session_id', sessionIds).order('created_at', { ascending: false })
  const visitsBySession = {}
  for (const v of visits ?? []) (visitsBySession[v.session_id] ??= []).push(v)

  return si.map(r => ({
    key: r.id,
    session: sessById[r.session_id],
    roleInSession: r.role_in_session,
    guards: (guardsBySi[r.id] ?? []).filter(Boolean),
    goalTitles: goalsBySi[r.id] ?? [],
    visits: visitsBySession[r.session_id] ?? [],
  })).filter(x => x.session).sort(byDateDesc)
}

// 獄卒視角:我參加過的每一場 + 那場我看守了哪些犯人
async function loadGuard(userId) {
  const { data: si } = await supabase.from('session_inmates')
    .select('id, session_id, role_in_session').eq('member_id', userId)
  if (!si || !si.length) return []
  const sessionIds = [...new Set(si.map(r => r.session_id))]

  const { data: sess } = await supabase.from('sessions').select(SESS_COLS).in('id', sessionIds)
  const sessById = {}; for (const s of sess ?? []) sessById[s.id] = s

  // 我看守的犯人(inmate_guards guard_id=我 → session_inmates 取 session/member → profiles 取名)
  const { data: igs } = await supabase.from('inmate_guards')
    .select('session_inmate_id').eq('guard_id', userId)
  const guardedSiIds = [...new Set((igs ?? []).map(g => g.session_inmate_id))]
  let guardedRows = []
  if (guardedSiIds.length) {
    const { data: gsi } = await supabase.from('session_inmates')
      .select('id, session_id, member_id').in('id', guardedSiIds)
    guardedRows = gsi ?? []
  }
  const memberIds = [...new Set(guardedRows.map(r => r.member_id))]
  const profById = {}
  if (memberIds.length) {
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name').in('id', memberIds)
    for (const p of profs ?? []) profById[p.id] = p
  }
  const guardedBySession = {}
  for (const r of guardedRows) (guardedBySession[r.session_id] ??= []).push(profById[r.member_id])

  return si.map(r => ({
    key: r.id,
    session: sessById[r.session_id],
    roleInSession: r.role_in_session,
    guarded: (guardedBySession[r.session_id] ?? []).filter(Boolean),
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
      <span className={`tag tag-pill rec-status ${s.status === 'open' ? 'open' : 'ended'}`}>{statusLabel(s)}</span>
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
  const isStaff = role === 'guard' || role === 'warden'
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)    // my_record_summary 結果
  const [topGuards, setTopGuards] = useState([])  // my_top_guards 結果(並列最高)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const result = role === 'warden' ? await loadWarden()
        : role === 'guard' ? await loadGuard(userId)
          : await loadMember(userId)
      if (alive) { setRows(result); setLoading(false) }
    })()
    return () => { alive = false }
  }, [userId, role])

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
          <div className="rec-stat">
            <div className="rec-stat-num">{summary.visits_received ?? 0}</div>
            <div className="rec-stat-lbl">收到探監</div>
          </div>
          {isStaff && (
            <div className="rec-stat">
              <div className="rec-stat-num">{summary.guard_count ?? 0}</div>
              <div className="rec-stat-lbl">看守次數</div>
            </div>
          )}
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

      {loading ? <p className="empty">讀取服刑紀錄中…</p>
        : rows.length === 0 ? <p className="empty">{role === 'warden' ? '目前沒有任何場次' : '你還沒有任何服刑紀錄'}</p>
          : role === 'warden' ? rows.map(rec => (
            <div key={rec.key} className="rec-card">
              <RecHead rec={rec} showRole={false} />
              <div className="rec-body">
                <div className="rec-row"><span className="rec-k">犯人</span><span className="rec-v">{rec.inmates} 人</span></div>
                <div className="rec-row"><span className="rec-k">獄卒</span><span className="rec-v">{rec.guards} 人</span></div>
              </div>
            </div>
          ))
            : role === 'guard' ? rows.map(rec => (
              <div key={rec.key} className="rec-card">
                <RecHead rec={rec} showRole={true} />
                <div className="rec-body">
                  <div className="rec-row">
                    <span className="rec-k">看守的犯人</span>
                    <span className="rec-v">{rec.guarded.length ? rec.guarded.map(guardName).join('、') : '本場無指派'}</span>
                  </div>
                </div>
              </div>
            ))
              : rows.map(rec => (
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
                                <span key={v.id} className="rec-visit">💌 {v.visitor_name}:{v.message}</span>
                              ))}
                            </span>}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
    </div>
  )
}
