import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'
import { cancelBooking } from './bookingApi'
import MessageBanner from './MessageBanner'

// 已預約場次（犯人/獄卒自己的視角）。全程樂觀更新,不整頁重抓。
//  - 我的預約：我預約且未結束的場次（public_sessions 已排除 ended），可預排任務、可取消。
//  - 不提供站內預約入口，要預約新場次一律導往官網（href="/"）。
const STATUS_PILL = {
  booking: { label: '預約中', bg: 'rgba(63,179,107,.15)', color: 'var(--ok)' },
  booking_paused: { label: '停止預約', bg: 'rgba(255,255,255,.08)', color: 'var(--dim)' },
  intake: { label: '開始入場', bg: 'rgba(255,255,255,.08)', color: 'var(--dim)' },
  serving: { label: '服刑中', bg: 'rgba(216,65,47,.15)', color: '#f0a99c' },
}

export default function MyBookings({ userId, onGoToManuscripts }) {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState([])      // public_sessions 原始列
  const [myBookings, setMyBookings] = useState([])  // 我的 bookings（未取消）
  const [goals, setGoals] = useState([])            // 我的 booking_goals
  const [actives, setActives] = useState([])        // 我的 active 稿件
  const [msById, setMsById] = useState({})          // manuscript_id -> {title}
  const [pickFor, setPickFor] = useState(null)      // 開著「預排任務」modal 的 session_id
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: pub }, { data: bks }, { data: bg }, { data: ms }] = await Promise.all([
      supabase.rpc('public_sessions'),
      supabase.from('bookings').select('id, session_id, status').eq('user_id', userId),
      supabase.from('booking_goals').select('id, session_id, manuscript_id').eq('user_id', userId),
      supabase.from('manuscripts').select('id, title, status').eq('member_id', userId).order('priority').order('created_at'),
    ])
    setSessions(pub ?? [])
    setMyBookings((bks ?? []).filter(b => b.status !== 'cancelled'))
    setGoals(bg ?? [])
    const m = {}; for (const x of ms ?? []) m[x.id] = x
    setMsById(m)
    setActives((ms ?? []).filter(x => x.status === 'active'))
    setLoading(false)
  }, [userId])

  useEffect(() => { if (userId) load() }, [userId, load])

  const bookedIds = new Set(myBookings.map(b => b.session_id))
  const goalsBySession = {}
  for (const g of goals) (goalsBySession[g.session_id] ??= []).push(g)
  const mySessions = sessions.filter(s => bookedIds.has(s.id))

  async function cancel(s) {
    const b = myBookings.find(x => x.session_id === s.id)
    if (!b || !window.confirm(`確定取消「${s.title}」的預約？`)) return
    const snapshot = myBookings
    setMyBookings(prev => prev.filter(x => x.session_id !== s.id))   // 樂觀移除
    const r = await cancelBooking(b.id)
    if (!r.ok) { setMyBookings(snapshot); setMsg('取消失敗，已還原：' + (r.error ?? '')); return }
    setMsg('已取消預約')
  }

  async function addGoal(sessionId, manuscriptId) {
    const title = msById[manuscriptId]?.title ?? '稿件'
    const optimistic = { id: 'tmp-' + manuscriptId, session_id: sessionId, manuscript_id: manuscriptId }
    setGoals(prev => [...prev, optimistic])   // 樂觀加入
    const { data, error } = await supabase.from('booking_goals')
      .insert({ user_id: userId, session_id: sessionId, manuscript_id: manuscriptId }).select().single()
    if (error) { setGoals(prev => prev.filter(g => g.id !== optimistic.id)); setMsg('加入失敗：' + error.message); return }
    setGoals(prev => prev.map(g => g.id === optimistic.id ? data : g))   // 換真 id
    setMsg(`「${title}」已加入`)   // 成功回饋,避免使用者以為畫面莫名刷掉
  }

  async function removeGoal(goalId) {
    const snapshot = goals
    setGoals(prev => prev.filter(g => g.id !== goalId))   // 樂觀移除
    const { error } = await supabase.from('booking_goals').delete().eq('id', goalId)
    if (error) { setGoals(snapshot); setMsg('移除失敗，已還原：' + error.message) }
  }

  if (loading) return <p className="empty">讀取已預約場次中…</p>

  return (
    <div className="ms-page">
      <MessageBanner msg={msg} onClose={() => setMsg('')} />
      <h3>已預約場次</h3>

      {mySessions.length === 0 ? (
        <div className="card-panel"><div className="body" style={{ textAlign: 'center', padding: '28px 18px' }}>
          <p className="empty" style={{ marginBottom: 14 }}>你目前沒有預約任何場次</p>
          <a className="btn-pri" href="/" style={{ display: 'inline-block', textDecoration: 'none' }}>前往官網預約 ▸</a>
        </div></div>
      ) : mySessions.map(s => {
        const sg = goalsBySession[s.id] ?? []
        const pill = STATUS_PILL[s.display_status] ?? STATUS_PILL.booking
        return (
          <div key={s.id} className="card-panel sg-section">
            <div className="head">
              <h2>{s.title}</h2>
              <span className="tag tag-pill" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
              <span className="muted">{s.session_date ?? '未定'}</span>
              <span className="spacer" />
              <button className="btn-sm btn-danger" onClick={() => cancel(s)}>取消預約</button>
            </div>
            <div className="body">
              <div className="subgroup first">預排任務（{sg.length}）<span className="ln" /></div>
              {sg.length === 0 ? (
                <p className="empty">還沒預排任務，點下方按鈕從你的稿件挑選</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {sg.map(g => (
                    <span key={g.id} className="chip" style={{ background: 'rgba(245,197,24,.15)', color: 'var(--hazard)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {msById[g.manuscript_id]?.title ?? '（稿件已不存在）'}
                      <button onClick={() => removeGoal(g.id)} style={{ border: 'none', background: 'none', color: 'inherit', padding: 0, minHeight: 'auto', cursor: 'pointer' }}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              <button className="btn-sm" onClick={() => setPickFor(s.id)}>＋ 預排任務</button>
            </div>
          </div>
        )
      })}

      {pickFor && (() => {
        const sessionId = pickFor
        const taken = new Set((goalsBySession[sessionId] ?? []).map(g => g.manuscript_id))
        const available = actives.filter(m => !taken.has(m.id))
        return (
          <div className="admin-modal-bg" onClick={() => setPickFor(null)}>
            <div className="admin-modal goal-modal" onClick={e => e.stopPropagation()}>
              <div className="goal-modal-head">
                <h3>預排任務</h3>
                <button className="goal-modal-x" onClick={() => setPickFor(null)}>✕</button>
              </div>
              {available.length === 0 ? (
                <div className="goal-modal-empty">
                  <p className="warn">沒有可以加入的稿件，請到「我的稿件」新增</p>
                  {onGoToManuscripts && <button className="btn-pri" onClick={() => { setPickFor(null); onGoToManuscripts() }}>前往我的稿件</button>}
                </div>
              ) : (
                <div className="goal-pick-list">
                  {available.map(m => (
                    <button key={m.id} className="goal-pick" onClick={() => addGoal(sessionId, m.id)}>
                      <span className="goal-pick-title">{m.title}</span>
                      <span className="goal-pick-add">＋ 加入</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
