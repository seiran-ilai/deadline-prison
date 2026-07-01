import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { normalizeStatus, SESSION_STATUS_LABEL } from './warden/constants'
import { SESSION_KIND_LABEL, DEFAULT_SESSION_KIND } from './sessionKind'

// 「看守紀錄」= 單一儀表板(不切分頁),記我「以獄卒身分(role_in_session='guard')」下場的每一場,新→舊。
// 用場次類型勾選過濾(自由入場無獄卒,故只有 集體趕稿 / 指名互動):
//   集體趕稿 — 看守次數・合照次數・互動次數;細項:看守的犯人 / 本場合照 / 本場互動。
//   指名互動 — 看守次數・被指名次數・拍立得次數;細項:看守的犯人 / 本場被指名 / 本場拍立得。
// 合照/互動 ← visits(guard_id=我、典獄長已確認);被指名/拍立得 ← my_guard_items()(RLS 僅典獄長,走 RPC 讀自己)。

const GUARD_KINDS = ['crunch', 'named']
const SESS_COLS = 'id, title, session_date, total_rounds, status, created_at, kind'
const dateKey = (s) => new Date(s?.session_date ?? s?.created_at ?? 0).getTime()
const byDateDesc = (a, b) => dateKey(b.session) - dateKey(a.session)
const sessionDate = (s) => (s?.session_date ? String(s.session_date).slice(0, 10) : '未定')
const statusLabel = (s) => SESSION_STATUS_LABEL[normalizeStatus(s)] ?? '已結束'
const personName = (p) => p?.game_name ?? p?.display_name ?? '（未知）'
const arr = (v) => (Array.isArray(v) ? v : [])
const kindOf = (rec) => (GUARD_KINDS.includes(rec?.session?.kind) ? rec.session.kind : DEFAULT_SESSION_KIND)

// 我以獄卒身分參加的每一場 + 我看守的犯人 + 本場已確認合照/互動 + 我被指名/拍立得數
async function loadGuardRecords(userId) {
  const { data: siAll } = await supabase.from('session_inmates')
    .select('id, session_id, role_in_session').eq('member_id', userId)
  const si = (siAll ?? []).filter(r => r.role_in_session === 'guard')
  if (!si.length) return []
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

  // 指定我執行、且典獄長已確認的合照/互動
  const { data: vs } = await supabase.from('visits')
    .select('session_id, photo_done, interact_done').eq('guard_id', userId)
  const photoBySession = {}, interactBySession = {}
  for (const v of vs ?? []) {
    if (v.photo_done) photoBySession[v.session_id] = (photoBySession[v.session_id] ?? 0) + 1
    if (v.interact_done) interactBySession[v.session_id] = (interactBySession[v.session_id] ?? 0) + 1
  }

  // 我被指名/拍立得(POS,RLS 僅典獄長,走 security definer RPC 讀自己)
  const { data: gi } = await supabase.rpc('my_guard_items')
  const posBySession = {}
  for (const it of gi ?? []) {
    const p = (posBySession[it.session_id] ??= { polaroid: 0, nominate: 0 })
    if (it.item_type === 'polaroid') p.polaroid += (it.qty || 0)
    if (it.item_type === 'nominate') p.nominate += arr(it.slot_times).length
  }

  return si.map(r => ({
    key: r.id,
    session: sessById[r.session_id],
    guarded: (guardedBySession[r.session_id] ?? []).filter(Boolean),
    photoCount: photoBySession[r.session_id] ?? 0,
    interactCount: interactBySession[r.session_id] ?? 0,
    polaroidCount: posBySession[r.session_id]?.polaroid ?? 0,
    nominateCount: posBySession[r.session_id]?.nominate ?? 0,
  })).filter(x => x.session).sort(byDateDesc)
}

// 一列鍵值(細項)
function Row({ k, children }) {
  return <div className="rec-row"><span className="rec-k">{k}</span><span className="rec-v">{children}</span></div>
}

function GRecCard({ rec }) {
  const s = rec.session
  const k = kindOf(rec)
  return (
    <div className="rec-card">
      <div className="rec-head">
        <span className={`kind-tag k-${k}`}>{SESSION_KIND_LABEL[k]}</span>
        <strong className="rec-title">{s.title}</strong>
        <span className="rec-meta mono">{sessionDate(s)}</span>
        <span className="rec-meta">{s.total_rounds ?? '—'} 輪</span>
        <span className="spacer" />
        <span className={`tag tag-pill rec-status ${normalizeStatus(s) === 'ended' ? 'ended' : 'open'}`}>{statusLabel(s)}</span>
      </div>
      <div className="rec-body">
        <Row k="看守的犯人">{rec.guarded.length ? rec.guarded.map(personName).join('、') : <span className="faint">本場無指派</span>}</Row>
        {k === 'crunch' ? (<>
          <Row k="本場合照">{rec.photoCount ? `${rec.photoCount} 次` : <span className="faint">—</span>}</Row>
          <Row k="本場互動">{rec.interactCount ? `${rec.interactCount} 次` : <span className="faint">—</span>}</Row>
        </>) : (<>
          <Row k="本場被指名">{rec.nominateCount ? `${rec.nominateCount} 次` : <span className="faint">—</span>}</Row>
          <Row k="本場拍立得">{rec.polaroidCount ? `${rec.polaroidCount} 張` : <span className="faint">—</span>}</Row>
        </>)}
      </div>
    </div>
  )
}

export default function GuardRecordsPage({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [active, setActive] = useState(new Set(GUARD_KINDS))

  useEffect(() => {
    let alive = true
    ;(async () => {
      const result = await loadGuardRecords(userId)
      if (alive) { setRows(result); setLoading(false) }
    })()
    return () => { alive = false }
  }, [userId])

  const stats = useMemo(() => {
    const s = {}
    for (const k of GUARD_KINDS) s[k] = { count: 0, photo: 0, interact: 0, nominate: 0, polaroid: 0 }
    for (const r of rows) {
      const k = kindOf(r)
      if (!s[k]) continue
      s[k].count += 1
      s[k].photo += r.photoCount; s[k].interact += r.interactCount
      s[k].nominate += r.nominateCount; s[k].polaroid += r.polaroidCount
    }
    return s
  }, [rows])

  const toggleKind = (k) => setActive(prev => {
    const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k)
    return n.size ? n : new Set(GUARD_KINDS)
  })
  const shown = rows.filter(r => active.has(kindOf(r)))

  const CARD_STATS = {
    crunch: (st) => ({ main: { num: st.count, lbl: '看守次數' }, subs: [
      { num: st.photo, lbl: '合照次數' }, { num: st.interact, lbl: '互動次數' },
    ] }),
    named: (st) => ({ main: { num: st.count, lbl: '看守次數' }, subs: [
      { num: st.nominate, lbl: '被指名次數' }, { num: st.polaroid, lbl: '拍立得次數' },
    ] }),
  }

  return (
    <div className="records-page">
      <h3>看守紀錄</h3>

      {/* 儀表板:場次類型統計卡(點卡 = 過濾勾選) */}
      <div className="rec-dash rec-dash-2">
        {GUARD_KINDS.map(k => {
          const on = active.has(k)
          const cs = CARD_STATS[k](stats[k])
          return (
            <div key={k} className={`rec-typecard k-${k} ${on ? 'on' : 'off'}`}>
              <button type="button" className="tc-head" onClick={() => toggleKind(k)} aria-pressed={on}>
                <span className={`tc-check ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                <span className="tc-name">{SESSION_KIND_LABEL[k]}</span>
              </button>
              <div className="tc-body">
                <div className="tc-main"><span className="tc-num">{cs.main.num}</span><span className="tc-lbl">{cs.main.lbl}</span></div>
                <div className="tc-subs">
                  {cs.subs.map((s, i) => (
                    <div key={i} className="tc-subrow"><span className="tsr-lbl">{s.lbl}</span><span className="tsr-val mono">{s.num}</span></div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {loading ? <p className="empty">讀取看守紀錄中…</p>
        : rows.length === 0 ? <p className="empty">你還沒有以獄卒身分下場的紀錄</p>
          : shown.length === 0 ? <p className="empty">目前篩選條件下沒有紀錄</p>
            : shown.map(rec => <GRecCard key={rec.key} rec={rec} />)}
    </div>
  )
}
