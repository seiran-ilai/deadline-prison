import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { normalizeStatus, SESSION_STATUS_LABEL } from './warden/constants'

// 「看守紀錄」分頁(獄卒/典獄長限定):只列自己以獄卒身分(role_in_session='guard')下場的場次,
// 格式比照「服刑紀錄」。統計卡:看守次數(my_record_summary)+ 合照次數/互動次數
// (visits.guard_id = 我、且典獄長已按「已經合照 / 已經執行指定互動」確認的筆數)。

const SESS_COLS = 'id, title, session_date, total_rounds, status, created_at'
const dateKey = (s) => new Date(s?.session_date ?? s?.created_at ?? 0).getTime()
const byDateDesc = (a, b) => dateKey(b.session) - dateKey(a.session)
const sessionDate = (s) => (s?.session_date ? String(s.session_date).slice(0, 10) : '未定')
const statusLabel = (s) => SESSION_STATUS_LABEL[normalizeStatus(s)] ?? '已結束'
const personName = (p) => p?.game_name ?? p?.display_name ?? '（未知）'

// 我以獄卒身分參加的每一場 + 那場我看守的犯人 + 本場已確認的合照/互動數(含全歷史總數)
async function loadGuardRecords(userId) {
  const { data: siAll } = await supabase.from('session_inmates')
    .select('id, session_id, role_in_session').eq('member_id', userId)
  const si = (siAll ?? []).filter(r => r.role_in_session === 'guard')
  if (!si.length) return { rows: [], photoTotal: 0, interactTotal: 0 }
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

  // 指定我執行、且典獄長已確認的合照/互動(一次撈全歷史,同時得出總數與各場次數)
  const { data: vs } = await supabase.from('visits')
    .select('id, session_id, photo_done, interact_done').eq('guard_id', userId)
  const photoBySession = {}, interactBySession = {}
  let photoTotal = 0, interactTotal = 0
  for (const v of vs ?? []) {
    if (v.photo_done) { photoTotal++; photoBySession[v.session_id] = (photoBySession[v.session_id] ?? 0) + 1 }
    if (v.interact_done) { interactTotal++; interactBySession[v.session_id] = (interactBySession[v.session_id] ?? 0) + 1 }
  }

  const rows = si.map(r => ({
    key: r.id,
    session: sessById[r.session_id],
    guarded: (guardedBySession[r.session_id] ?? []).filter(Boolean),
    photoCount: photoBySession[r.session_id] ?? 0,
    interactCount: interactBySession[r.session_id] ?? 0,
  })).filter(x => x.session).sort(byDateDesc)
  return { rows, photoTotal, interactTotal }
}

export default function GuardRecordsPage({ userId }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [photoTotal, setPhotoTotal] = useState(0)
  const [interactTotal, setInteractTotal] = useState(0)
  const [guardCount, setGuardCount] = useState(null)  // my_record_summary.guard_count

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [recs, { data: sum }] = await Promise.all([
        loadGuardRecords(userId),
        supabase.rpc('my_record_summary'),
      ])
      if (!alive) return
      setRows(recs.rows)
      setPhotoTotal(recs.photoTotal)
      setInteractTotal(recs.interactTotal)
      const s = Array.isArray(sum) ? (sum[0] ?? null) : (sum ?? null)
      setGuardCount(s?.guard_count ?? 0)
      setLoading(false)
    })()
    return () => { alive = false }
  }, [userId])

  return (
    <div className="records-page">
      <h3>看守紀錄</h3>

      {/* 統計卡:格式比照服刑紀錄的 rec-summary */}
      <div className="rec-summary">
        <div className="rec-stat">
          <div className="rec-stat-num">{guardCount ?? '—'}</div>
          <div className="rec-stat-lbl">看守次數</div>
        </div>
        <div className="rec-stat">
          <div className="rec-stat-num">{photoTotal}</div>
          <div className="rec-stat-lbl">合照次數</div>
        </div>
        <div className="rec-stat">
          <div className="rec-stat-num">{interactTotal}</div>
          <div className="rec-stat-lbl">互動次數</div>
        </div>
      </div>

      {loading ? <p className="empty">讀取看守紀錄中…</p>
        : rows.length === 0 ? <p className="empty">你還沒有以獄卒身分下場的紀錄</p>
          : rows.map(rec => {
            const s = rec.session
            return (
              <div key={rec.key} className="rec-card">
                <div className="rec-head">
                  <strong className="rec-title">{s.title}</strong>
                  <span className="rec-meta mono">{sessionDate(s)}</span>
                  <span className="rec-meta">{s.total_rounds ?? '—'} 輪</span>
                  <span className="role-tag guard">獄卒</span>
                  <span className="spacer" />
                  <span className={`tag tag-pill rec-status ${normalizeStatus(s) === 'ended' ? 'ended' : 'open'}`}>{statusLabel(s)}</span>
                </div>
                <div className="rec-body">
                  <div className="rec-row">
                    <span className="rec-k">看守的犯人</span>
                    <span className="rec-v">{rec.guarded.length ? rec.guarded.map(personName).join('、') : '本場無指派'}</span>
                  </div>
                  <div className="rec-row">
                    <span className="rec-k">本場合照</span>
                    <span className="rec-v">{rec.photoCount ? `${rec.photoCount} 次` : <span className="faint">—</span>}</span>
                  </div>
                  <div className="rec-row">
                    <span className="rec-k">本場指定互動</span>
                    <span className="rec-v">{rec.interactCount ? `${rec.interactCount} 次` : <span className="faint">—</span>}</span>
                  </div>
                </div>
              </div>
            )
          })}
    </div>
  )
}
