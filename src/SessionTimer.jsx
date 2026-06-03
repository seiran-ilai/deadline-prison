import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { pomodoroState, PHASE_LABEL, fmt } from './pomodoro'

const PHASE_BG = {
  focus: '#d9534f',     // 服刑中(專注)
  break: '#2a8',        // 放風
  longbreak: '#3a7bd0', // 長休息
  ended: '#666',
}

export default function SessionTimer({ userId }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)  // { id, title, timer_started_at, total_rounds }
  const [, setTick] = useState(0)               // 每秒觸發重算

  // 讀我所在 open 場次的計時資訊;每 10 秒重抓(接收典獄長開始/重置)
  async function loadSession() {
    const { data: si } = await supabase.from('session_inmates')
      .select('session_id').eq('member_id', userId)
    let sess = null
    if (si && si.length) {
      const { data: open } = await supabase.from('sessions')
        .select('id, title, timer_started_at, total_rounds')
        .in('id', si.map(r => r.session_id)).eq('status', 'open')
      if (open && open.length) sess = open[0]
    }
    setSession(sess); setLoading(false)
  }
  useEffect(() => {
    if (!userId) return
    loadSession()
    const t = setInterval(loadSession, 10000)
    return () => clearInterval(t)
  }, [userId])

  // 每秒重算畫面(純前端計算,不打 DB)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const card = { border: '1px solid #ddd', borderRadius: 8, padding: 24, background: '#fff', color: '#222', textAlign: 'center' }

  if (loading) return <p style={{ color: '#888' }}>讀取本場計時中…</p>
  if (!session) {
    return <div style={{ ...card, color: '#666' }}>你目前不在任何服刑場次中,請等典獄長報到</div>
  }
  if (!session.timer_started_at) {
    return (
      <div style={card}>
        <p style={{ color: '#888', fontSize: 18, margin: 0 }}>等待典獄長開始服刑…</p>
        <p style={{ color: '#aaa', fontSize: 13, marginBottom: 0 }}>本場:{session.title} · 共 {session.total_rounds ?? 8} 輪</p>
      </div>
    )
  }

  const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
  const st = pomodoroState(elapsed, session.total_rounds ?? 8)

  if (st.ended) {
    return (
      <div style={card}>
        <p style={{ fontSize: 28, fontWeight: 700, margin: '8px 0' }}>🔓 本場服刑結束</p>
        <p style={{ color: '#888' }}>本場:{session.title} · 共 {session.total_rounds ?? 8} 輪 已全部完成</p>
      </div>
    )
  }

  return (
    <div style={card}>
      <div style={{ color: '#888', fontSize: 14 }}>本場:{session.title}</div>
      <div style={{ display: 'inline-block', margin: '12px 0', padding: '4px 16px', borderRadius: 16, color: '#fff', background: PHASE_BG[st.phase] }}>
        {PHASE_LABEL[st.phase]}
      </div>
      <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', letterSpacing: 2 }}>
        {fmt(st.remainingSeconds)}
      </div>
      <div style={{ color: '#666', marginTop: 8, fontSize: 16 }}>
        第 {st.round} 輪 / 共 {session.total_rounds ?? 8} 輪
      </div>
    </div>
  )
}
