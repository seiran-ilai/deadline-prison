import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { normalizeStatus, SESSION_STATUS_LABEL } from './warden/constants'
import { SESSION_KIND_LABEL, SESSION_KINDS, DEFAULT_SESSION_KIND } from './sessionKind'

// 「服刑紀錄」= 單一儀表板(不切分頁),記「以犯人身分下場」的每一場,一律「新→舊」。
// 用場次類型勾選過濾:集體趕稿 / 指名互動 / 自由入場。每型的統計與細項不同:
//   集體趕稿 — 服刑次數・累計服刑・收到探監;細項:場次監督獄卒 / 已完成目標 / 探監紀錄。
//   指名互動 — 服刑次數;細項:該場品項與當場明細(POS 加購)/ 已完成目標。
//   自由入場 — 服刑次數;細項:已完成目標。
// 全部「分開查再 JS 合併」,不用巢狀 select。POS 明細以 my_pos_items() RPC 讀自己的(RLS 僅限典獄長)。

const SESS_COLS = 'id, title, session_date, total_rounds, status, created_at, kind'
const dateKey = (s) => new Date(s?.session_date ?? s?.created_at ?? 0).getTime()
const byDateDesc = (a, b) => dateKey(b.session) - dateKey(a.session)
const sessionDate = (s) => (s?.session_date ? String(s.session_date).slice(0, 10) : '未定')
const statusLabel = (s) => SESSION_STATUS_LABEL[normalizeStatus(s)] ?? '已結束'
const guardName = (p) => p?.game_name ?? p?.display_name ?? '（未知）'
const kindOf = (rec) => (SESSION_KINDS.includes(rec?.session?.kind) ? rec.session.kind : DEFAULT_SESSION_KIND)
const arr = (v) => (Array.isArray(v) ? v : [])

// POS 品項中文(對應 pos_order_items.item_type)
const ITEM_LABEL = { signup: '現場報名', visit: '互動探監', polaroid: '拍立得', portrait: '肖像畫', nominate: '指名時段', sign: '簽繪', entry: '入場' }
function itemDesc(it) {
  if (it.item_type === 'polaroid') return `拍立得 ${it.qty ?? 0} 張${it.with_signature ? '（含簽繪）' : ''}`
  if (it.item_type === 'nominate') { const n = arr(it.slot_times).length; return `指名時段${n ? ` ${n} 段` : ''}` }
  return ITEM_LABEL[it.item_type] ?? it.item_type
}

// 犯人視角:我「以犯人身分」參加的每一場 + 該場監督/專屬獄卒 + 已完成目標稿名 + 收到的探監 + 我的 POS 品項
async function loadMember(userId) {
  const { data: siAll } = await supabase.from('session_inmates')
    .select('id, session_id, role_in_session').eq('member_id', userId)
  const si = (siAll ?? []).filter(r => r.role_in_session !== 'guard')
  if (!si.length) return []
  const sessionIds = [...new Set(si.map(r => r.session_id))]
  const siIds = si.map(r => r.id)

  const { data: sess } = await supabase.from('sessions').select(SESS_COLS).in('id', sessionIds)
  const sessById = {}; for (const s of sess ?? []) sessById[s.id] = s

  // 那場我的監督/專屬獄卒(inmate_guards → profiles)
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

  // 已完成目標稿名(session_goals → manuscripts;只列 is_done)
  const { data: goals } = await supabase.from('session_goals')
    .select('session_inmate_id, manuscript_id').in('session_inmate_id', siIds)
  const msIds = [...new Set((goals ?? []).map(g => g.manuscript_id))]
  const titleById = {}, doneById = {}
  if (msIds.length) {
    const { data: ms } = await supabase.from('manuscripts').select('id, title, is_done').in('id', msIds)
    for (const m of ms ?? []) { titleById[m.id] = m.title; doneById[m.id] = m.is_done }
  }
  const goalsBySi = {}
  for (const g of goals ?? [])
    if (doneById[g.manuscript_id]) (goalsBySi[g.session_inmate_id] ??= []).push(titleById[g.manuscript_id] ?? '（稿件已不存在）')

  // 收到的探監(visits inmate_id=我,本場;新→舊;含指定獄卒)
  const { data: visits } = await supabase.from('visits')
    .select('id, session_id, guard_id, visitor_name, message, created_at')
    .eq('inmate_id', userId).in('session_id', sessionIds).order('created_at', { ascending: false })
  const vGuardIds = [...new Set((visits ?? []).map(v => v.guard_id).filter(Boolean).filter(id => !guardById[id]))]
  if (vGuardIds.length) {
    const { data: vgp } = await supabase.from('profiles')
      .select('id, game_name, display_name').in('id', vGuardIds)
    for (const p of vgp ?? []) guardById[p.id] = p
  }
  const visitsBySession = {}
  for (const v of visits ?? [])
    (visitsBySession[v.session_id] ??= []).push({ ...v, guard_name: v.guard_id ? guardName(guardById[v.guard_id]) : null })

  // 我的 POS 品項(指名互動場的加購與明細;RLS 僅典獄長,改走 security definer RPC 依本人暱稱比對)
  const { data: myItems } = await supabase.rpc('my_pos_items')
  const itemsBySession = {}
  for (const it of myItems ?? []) (itemsBySession[it.session_id] ??= []).push(it)

  return si.map(r => ({
    key: r.id,
    session: sessById[r.session_id],
    guards: (guardsBySi[r.id] ?? []).filter(Boolean),
    goalTitles: goalsBySi[r.id] ?? [],
    visits: visitsBySession[r.session_id] ?? [],
    items: itemsBySession[r.session_id] ?? [],
  })).filter(x => x.session).sort(byDateDesc)
}

function RecHead({ rec }) {
  const s = rec.session
  const k = kindOf(rec)
  return (
    <div className="rec-head">
      <span className={`kind-tag k-${k}`}>{SESSION_KIND_LABEL[k]}</span>
      <strong className="rec-title">{s.title}</strong>
      <span className="rec-meta mono">{sessionDate(s)}</span>
      <span className="rec-meta">{s.total_rounds ?? '—'} 輪</span>
      <span className="spacer" />
      <span className={`tag tag-pill rec-status ${normalizeStatus(s) === 'ended' ? 'ended' : 'open'}`}>{statusLabel(s)}</span>
    </div>
  )
}

// 服刑時數估算:輪數 × 25 分,換算「X 小時 Y 分」。明確為估算,非實際工時。(導覽示範頁共用)
export function fmtRounds(rounds) {
  const mins = (rounds ?? 0) * 25
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`
}

// 一列鍵值(細項)
function Row({ k, children }) {
  return (
    <div className="rec-row">
      <span className="rec-k">{k}</span>
      <span className="rec-v">{children}</span>
    </div>
  )
}

// 探監清單(集體趕稿細項共用)
function VisitList({ visits }) {
  if (!visits.length) return <span className="faint">本場無人探監</span>
  return (
    <span className="rec-visits">
      {visits.map(v => (
        <span key={v.id} className="rec-visit">
          💌 {v.visitor_name}：{v.message}
          {v.guard_name && <span className="faint">（🛡 {v.guard_name}）</span>}
        </span>
      ))}
    </span>
  )
}

// 依場次類型渲染細項(集體趕稿 / 指名互動 / 自由入場)
function RecCard({ rec }) {
  const k = kindOf(rec)
  const goals = rec.goalTitles.length ? rec.goalTitles.join('、') : '無'
  return (
    <div className="rec-card">
      <RecHead rec={rec} />
      <div className="rec-body">
        {k === 'crunch' && (<>
          <Row k="場次監督獄卒">{rec.guards.length ? rec.guards.map(guardName).join('、') : '無'}</Row>
          <Row k="已完成目標">{goals}</Row>
          <Row k="探監紀錄"><VisitList visits={rec.visits} /></Row>
        </>)}
        {k === 'named' && (<>
          <Row k="品項與明細">
            {rec.items.length === 0 ? <span className="faint">無加購紀錄</span> : (
              <span className="rec-items">
                {rec.items.map((it, i) => (
                  <span key={i} className="rec-item">
                    <span className="ri-name">{itemDesc(it)}</span>
                    {it.guard_name && <span className="ri-guard">🛡 {it.guard_name}</span>}
                    <span className="ri-amt mono">{it.amount ?? 0} 萬</span>
                  </span>
                ))}
                <span className="rec-item rec-item-total">
                  <span className="ri-name">合計</span>
                  <span className="ri-amt mono">{rec.items.reduce((s, it) => s + (it.amount ?? 0), 0)} 萬</span>
                </span>
              </span>
            )}
          </Row>
          <Row k="已完成目標">{goals}</Row>
        </>)}
        {k === 'free' && (
          <Row k="已完成目標">{goals}</Row>
        )}
      </div>
    </div>
  )
}

export default function RecordsPage({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [active, setActive] = useState(new Set(SESSION_KINDS))  // 場次類型過濾(預設全開)
  const [visitLog, setVisitLog] = useState(null)                // 過去廣播紀錄 modal

  useEffect(() => {
    let alive = true
    ;(async () => {
      const result = await loadMember(userId)
      if (alive) { setRows(result); setLoading(false) }
    })()
    return () => { alive = false }
  }, [userId])

  // 每型統計(由已載入紀錄即時彙整)
  const stats = useMemo(() => {
    const s = {}
    for (const k of SESSION_KINDS) s[k] = { count: 0, rounds: 0, visits: 0 }
    for (const r of rows) {
      const k = kindOf(r)
      s[k].count += 1
      s[k].rounds += r.session.total_rounds ?? 0
      s[k].visits += r.visits.length
    }
    return s
  }, [rows])

  // 追加統計:拍立得次數(獨立,不入三類別)、累計金額、最常指名(指名互動,依購入時段數)、最常合照(拍立得張數最多的對象獄卒)
  const extra = useMemo(() => {
    const items = rows.flatMap(r => r.items ?? [])
    const polaroidCount = items.filter(i => i.item_type === 'polaroid').reduce((s, i) => s + (i.qty || 0), 0)
    const totalSpent = items.reduce((s, i) => s + (i.amount || 0), 0)
    const topOf = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const nomCount = {}, polCount = {}
    for (const i of items) {
      if (!i.guard_name) continue
      if (i.item_type === 'nominate') nomCount[i.guard_name] = (nomCount[i.guard_name] || 0) + Math.max(1, arr(i.slot_times).length)
      if (i.item_type === 'polaroid') polCount[i.guard_name] = (polCount[i.guard_name] || 0) + (i.qty || 1)
    }
    return { polaroidCount, totalSpent, topNominated: topOf(nomCount), topPolaroid: topOf(polCount) }
  }, [rows])

  const toggleKind = (k) => setActive(prev => {
    const n = new Set(prev)
    n.has(k) ? n.delete(k) : n.add(k)
    return n.size ? n : new Set(SESSION_KINDS)   // 全部取消 → 視為全開,避免空白
  })

  const shown = rows.filter(r => active.has(kindOf(r)))

  // 過去廣播紀錄(收到的全部探監,跨場次新→舊)
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

  // 每型別的統計卡設定:main=主數字(服刑次數),subs=下方逐列次要統計
  const CARD_STATS = {
    crunch: (st) => ({
      main: { num: st.count, lbl: '服刑次數' },
      subs: [
        { num: fmtRounds(st.rounds), lbl: '累計服刑（估算）', title: '依場次規劃輪數估算，非實際工時' },
        { num: st.visits, lbl: '收到探監', onClick: openVisitLog },
      ],
    }),
    named: (st) => ({
      main: { num: st.count, lbl: '服刑次數' },
      subs: [{ num: extra.topNominated ?? '—', lbl: '最常指名' }],
    }),
    free: (st) => ({ main: { num: st.count, lbl: '服刑次數' }, subs: [] }),
  }

  return (
    <div className="records-page">
      <h3>服刑紀錄</h3>

      {/* 儀表板:場次類型統計卡(點卡 = 過濾勾選) */}
      <div className="rec-dash">
        {SESSION_KINDS.map(k => {
          const on = active.has(k)
          return (
            <div key={k} className={`rec-typecard k-${k} ${on ? 'on' : 'off'}`}>
              <button type="button" className="tc-head" onClick={() => toggleKind(k)} aria-pressed={on}>
                <span className={`tc-check ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                <span className="tc-name">{SESSION_KIND_LABEL[k]}</span>
              </button>
              {(() => {
                const cs = CARD_STATS[k](stats[k])
                return (
                  <div className="tc-body">
                    <div className="tc-main"><span className="tc-num">{cs.main.num}</span><span className="tc-lbl">{cs.main.lbl}</span></div>
                    {cs.subs.length > 0 && (
                      <div className="tc-subs">
                        {cs.subs.map((s, i) => s.onClick
                          ? <button key={i} type="button" className="tc-subrow tc-subrow-btn" onClick={s.onClick} title="點擊查看過去廣播紀錄">
                              <span className="tsr-lbl">{s.lbl} ▸</span><span className="tsr-val mono">{s.num}</span>
                            </button>
                          : <div key={i} className="tc-subrow" title={s.title || undefined}>
                              <span className="tsr-lbl">{s.lbl}</span><span className="tsr-val mono">{s.num}</span>
                            </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}

        {/* 追加統計卡:拍立得次數(獨立,不記錄在三類別之下)+ 最常合照獄卒 + 累計金額。純顯示,不參與過濾。 */}
        <div className="rec-typecard k-extra on">
          <div className="tc-head tc-head-static">
            <span className="tc-name">消費統計</span>
          </div>
          <div className="tc-body">
            <div className="tc-main"><span className="tc-num">{extra.polaroidCount}</span><span className="tc-lbl">拍立得（張）</span></div>
            <div className="tc-subs">
              <div className="tc-subrow" title="拍立得張數最多的對象獄卒">
                <span className="tsr-lbl">最常合照</span><span className="tsr-val mono">{extra.topPolaroid ?? '—'}</span>
              </div>
              <div className="tc-subrow">
                <span className="tsr-lbl">累計金額</span><span className="tsr-val mono">{extra.totalSpent} 萬</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 紀錄清單(依勾選過濾,新→舊) */}
      {loading ? <p className="empty">讀取服刑紀錄中…</p>
        : rows.length === 0 ? <p className="empty">你還沒有任何服刑紀錄</p>
          : shown.length === 0 ? <p className="empty">目前篩選條件下沒有紀錄</p>
            : shown.map(rec => <RecCard key={rec.key} rec={rec} />)}

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
