import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { pomodoroState, PHASE_LABEL, fmt } from './pomodoro'

const PHASE_BG = {
  focus: '#d9534f',
  break: '#2a8',
  longbreak: '#3a7bd0',
  ended: '#666',
}

function PersonAvatar({ profile, size }) {
  const name = profile?.game_name ?? profile?.display_name ?? ''
  const initial = name ? name[0] : (profile?.inmate_no != null ? String(profile.inmate_no).slice(-2) : '?')
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#555', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4 }}>
      {initial}
    </div>
  )
}

export default function BroadcastScreen({ sessionId }) {
  const [session, setSession] = useState(null)  // { title, timer_started_at, total_rounds }
  const [guards, setGuards] = useState([])
  const [inmates, setInmates] = useState([])
  const [notFound, setNotFound] = useState(false)
  const [, setTick] = useState(0)

  // 場次 + 名單(每 10 秒輪詢,接收計時開始/晚進場)
  async function loadData() {
    const { data: sess } = await supabase.from('sessions')
      .select('title, timer_started_at, timer_ended_at, total_rounds').eq('id', sessionId).single()
    if (!sess) { setNotFound(true); return }
    setSession(sess)
    const { data: si } = await supabase.from('session_inmates')
      .select('member_id, role_in_session').eq('session_id', sessionId)
    if (!si || si.length === 0) { setGuards([]); setInmates([]); return }
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', si.map(r => r.member_id))
    const profById = {}; for (const p of profs ?? []) profById[p.id] = p
    const merged = si.map(r => ({ role_in_session: r.role_in_session, profile: profById[r.member_id] }))
    setGuards(merged.filter(m => m.role_in_session === 'guard'))
    setInmates(merged.filter(m => m.role_in_session !== 'guard'))
  }
  useEffect(() => {
    if (!sessionId) return
    loadData()
    const t = setInterval(loadData, 10000)
    return () => clearInterval(t)
  }, [sessionId])

  // 每秒重算番茄鐘(純前端)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const screen = {
    minHeight: '100vh', background: '#1a1a1a', color: '#fff', fontFamily: 'sans-serif',
    padding: 40, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 32,
  }

  if (notFound) return <div style={{ ...screen, justifyContent: 'center', alignItems: 'center' }}>查無此場次</div>
  if (!session) return <div style={{ ...screen, justifyContent: 'center', alignItems: 'center' }}>讀取中…</div>

  // 番茄鐘狀態
  let timerBlock
  if (!session.timer_started_at) {
    timerBlock = <div style={{ fontSize: 48, color: '#aaa' }}>尚未開始服刑</div>
  } else {
    const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
    const st = pomodoroState(elapsed, session.total_rounds ?? 8, session.timer_ended_at)
    if (st.ended) {
      timerBlock = <div style={{ fontSize: 64, fontWeight: 800 }}>🔓 本場服刑結束</div>
    } else {
      timerBlock = (
        <>
          <div style={{ display: 'inline-block', padding: '6px 24px', borderRadius: 24, fontSize: 32, background: PHASE_BG[st.phase] }}>
            {PHASE_LABEL[st.phase]}
          </div>
          <div style={{ fontSize: 160, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: 4 }}>
            {fmt(st.remainingSeconds)}
          </div>
          <div style={{ fontSize: 32, color: '#ccc' }}>第 {st.round} 輪 / 共 {session.total_rounds ?? 8} 輪</div>
        </>
      )
    }
  }

  return (
    <div style={screen}>
      <div style={{ fontSize: 28, color: '#bbb', textAlign: 'center' }}>死線監獄 · {session.title}</div>

      {/* 番茄鐘(主角) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        {timerBlock}
      </div>

      {/* 本場獄卒 */}
      <div>
        <div style={{ fontSize: 24, color: '#e08e0b', marginBottom: 12 }}>本場獄卒</div>
        {guards.length === 0 ? <div style={{ color: '#777', fontSize: 20 }}>無</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            {guards.map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <PersonAvatar profile={g.profile} size={160} />
                <span style={{ fontSize: 24 }}>{g.profile?.game_name ?? g.profile?.display_name ?? '?'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 本場囚犯 */}
      <div>
        <div style={{ fontSize: 24, color: '#d9534f', marginBottom: 12 }}>本場囚犯（{inmates.length}）</div>
        {inmates.length === 0 ? <div style={{ color: '#777', fontSize: 20 }}>本場還沒有囚犯</div> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
            {inmates.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 260 }}>
                <PersonAvatar profile={m.profile} size={240} />
                <span style={{ fontSize: 18, textAlign: 'center' }}>{m.profile?.game_name ?? m.profile?.display_name ?? '?'}</span>
                <span style={{ fontSize: 14, color: '#888' }}>No.{m.profile?.inmate_no != null ? String(m.profile.inmate_no).padStart(4, '0') : '----'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
