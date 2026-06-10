import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { pomodoroState, PHASE_LABEL, fmt } from './pomodoro'

// 直播大螢幕:獨立視窗(不在 .admin 底下),配色沿用監獄色票,全部 inline style。
const C = {
  bg: '#0c0d0f', panel: '#15171b', line: 'rgba(255,255,255,.08)',
  text: '#e4e5e7', dim: '#9298a2', faint: '#5a606a',
  hazard: '#f5c518', alarm: '#d8412f', ok: '#3fb36b',
}
const MONO = "'Space Mono', monospace"
const CJK = "'Noto Sans TC', sans-serif"

// 階段配色(底淡字濃,與主控台計時器一致)
const PHASE_STYLE = {
  focus: { bg: 'rgba(245,197,24,.16)', color: C.hazard },
  break: { bg: 'rgba(63,179,107,.16)', color: C.ok },
  longbreak: { bg: 'rgba(58,123,208,.18)', color: '#7fb0ea' },
}

// 黃黑警示斜紋條
const hazardStripe = (h = 10) => ({
  height: h, flex: '0 0 auto',
  background: 'repeating-linear-gradient(45deg,#f5c518 0 18px,#0a0a0a 18px 36px)',
})

// 方形拘留照頭貼(有照片用照片,無照片用首字)
function PersonAvatar({ profile, size }) {
  const name = profile?.game_name ?? profile?.display_name ?? ''
  const initial = name ? name[0] : (profile?.inmate_no != null ? String(profile.inmate_no).slice(-2) : '?')
  const frame = {
    width: size, height: size, borderRadius: 10, overflow: 'hidden', flex: '0 0 auto',
    border: `1px solid ${C.line}`, background: '#1d2127',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: C.dim, fontFamily: MONO, fontWeight: 700, fontSize: size * 0.34,
  }
  return (
    <div style={frame}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initial}
    </div>
  )
}

// 區段標籤(小字 + 延伸線)
function SectionLabel({ children, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
      <span style={{ fontSize: 20, letterSpacing: 4, color, fontFamily: CJK, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: C.line }} />
    </div>
  )
}

export default function BroadcastScreen({ sessionId }) {
  const [session, setSession] = useState(null)  // { title, timer_started_at, total_rounds }
  const [guards, setGuards] = useState([])
  const [inmates, setInmates] = useState([])
  const [visits, setVisits] = useState([])      // 本場未完成廣播(新→舊;標記完成即退出輪播)
  const [visitIdx, setVisitIdx] = useState(0)   // 探監輪播目前索引
  const [notFound, setNotFound] = useState(false)
  const [, setTick] = useState(0)

  // 場次 + 名單(每 10 秒輪詢,接收計時開始/晚進場/標記完成)
  async function loadData() {
    const { data: sess } = await supabase.from('sessions')
      .select('title, timer_started_at, timer_ended_at, total_rounds').eq('id', sessionId).single()
    if (!sess) { setNotFound(true); return }
    setSession(sess)
    // 本場廣播輪播:只取未完成(is_done=false);完成的留在紀錄,不再輪播
    const { data: vs } = await supabase.from('visits')
      .select('id, inmate_id, guard_id, visitor_name, message, created_at')
      .eq('session_id', sessionId).eq('is_done', false).order('created_at', { ascending: false })
    setVisits(vs ?? [])
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

  // 探監輪播:多筆時每 7 秒切下一筆;一筆固定、零筆不顯示(modulo 容忍筆數變動)
  useEffect(() => {
    if (visits.length <= 1) return
    const t = setInterval(() => setVisitIdx(i => (i + 1) % visits.length), 7000)
    return () => clearInterval(t)
  }, [visits.length])

  // 標記完成:結束這則廣播在大螢幕/犯人頁/獄卒頁的輪播(此視窗為典獄長開啟,沿用其權限)
  async function markVisitDone(v) {
    const { error } = await supabase.from('visits').update({ is_done: true }).eq('id', v.id)
    if (error) { window.alert('標記失敗：' + error.message); return }
    loadData()
  }

  const screen = {
    minHeight: '100vh', background: C.bg, color: C.text, fontFamily: CJK,
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
  }
  const inner = { padding: '28px 44px 44px', display: 'flex', flexDirection: 'column', gap: 34, flex: 1 }

  if (notFound) return <div style={{ ...screen, justifyContent: 'center', alignItems: 'center' }}>查無此場次</div>
  if (!session) return <div style={{ ...screen, justifyContent: 'center', alignItems: 'center' }}>讀取中…</div>

  // 番茄鐘狀態(2.2:階段徽章 + 大鐘 + 第幾輪 + 輪次圓點)
  const N = session.total_rounds ?? 8
  let timerBlock
  if (!session.timer_started_at) {
    timerBlock = <div style={{ fontSize: 46, color: C.dim, letterSpacing: 4 }}>尚未開始服刑</div>
  } else {
    const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
    const st = pomodoroState(elapsed, N, session.timer_ended_at)
    if (st.ended) {
      timerBlock = <div style={{ fontSize: 62, fontWeight: 900, letterSpacing: 4 }}>🔓 本場服刑結束</div>
    } else {
      const ps = PHASE_STYLE[st.phase] ?? PHASE_STYLE.focus
      timerBlock = (
        <>
          <div style={{
            display: 'inline-block', padding: '8px 28px', borderRadius: 6, fontSize: 30,
            fontWeight: 700, letterSpacing: 6, background: ps.bg, color: ps.color,
          }}>
            {PHASE_LABEL[st.phase]}
          </div>
          <div style={{
            fontSize: 170, fontWeight: 700, lineHeight: 1, letterSpacing: 6,
            fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
            textShadow: st.phase === 'focus' ? '0 0 80px rgba(245,197,24,.25)' : 'none',
          }}>
            {fmt(st.remainingSeconds)}
          </div>
          <div style={{ fontSize: 28, color: C.dim, fontFamily: MONO, letterSpacing: 2 }}>
            第 <b style={{ color: C.text }}>{st.round}</b> / {N} 輪
          </div>
          {/* 輪次進度圓點:已完成=實黃、目前=發光、未到=暗格 */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {Array.from({ length: N }, (_, i) => {
              const n = i + 1
              const style = n < st.round
                ? { background: '#caa00f' }
                : n === st.round
                  ? { background: C.hazard, boxShadow: '0 0 14px rgba(245,197,24,.6)' }
                  : { background: 'rgba(255,255,255,.1)' }
              return <i key={n} style={{ width: 34, height: 10, borderRadius: 5, ...style }} />
            })}
          </div>
        </>
      )
    }
  }

  return (
    <div style={screen}>
      {/* 頂部:警示斜紋 + 場次標題列 */}
      <div style={hazardStripe(10)} />
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 16, padding: '18px 44px 0',
        justifyContent: 'center',
      }}>
        <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: 3 }}>死線<b style={{ color: C.hazard }}>監獄</b></span>
        <span style={{ fontSize: 14, color: C.faint, fontFamily: MONO, letterSpacing: 3 }}>DEADLINE PRISON · LIVE</span>
        <span style={{ fontSize: 22, color: C.dim }}>｜ {session.title}</span>
      </div>

      <div style={inner}>
        {/* 番茄鐘(主角) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          {timerBlock}
        </div>

        {/* 探監廣播輪播(2.3/2.4:只輪播未完成;標記完成即移出輪播) */}
        {visits.length > 0 && (() => {
          const profById = {}
          for (const m of [...inmates, ...guards]) if (m.profile) profById[m.profile.id] = m.profile
          const v = visits[visitIdx % visits.length]
          if (!v) return null
          const ip = profById[v.inmate_id]
          const inmateName = ip?.game_name ?? ip?.display_name ?? '某囚'
          const no = ip?.inmate_no != null ? String(ip.inmate_no).padStart(4, '0') : '----'
          const gp = v.guard_id ? profById[v.guard_id] : null
          const guardName = v.guard_id ? (gp?.game_name ?? gp?.display_name ?? null) : null
          return (
            <div style={{
              background: 'linear-gradient(90deg,#241a35,#15131c)', border: '1px solid #b56fd9',
              borderLeft: '5px solid #b56fd9', borderRadius: 12, padding: '20px 32px',
              display: 'flex', alignItems: 'center', gap: 28,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, color: '#c89be0', letterSpacing: 4, fontFamily: MONO, marginBottom: 8 }}>
                  💌 探監廣播{visits.length > 1 ? ` · ${(visitIdx % visits.length) + 1} / ${visits.length}` : ''}
                </div>
                <div style={{ fontSize: 32, fontWeight: 800 }}>
                  〈{v.visitor_name}〉 探望 <span style={{ color: C.hazard }}>No.{no} {inmateName}</span>
                </div>
                <div style={{ fontSize: 28, marginTop: 8 }}>「{v.message}」</div>
                {guardName && <div style={{ fontSize: 20, color: '#9bd0a8', marginTop: 8 }}>🛡 指定獄卒：{guardName}</div>}
              </div>
              <button
                onClick={() => markVisitDone(v)}
                style={{
                  flex: '0 0 auto', cursor: 'pointer', background: 'transparent',
                  border: '1px solid #b56fd9', color: '#c89be0', borderRadius: 8,
                  padding: '12px 20px', fontSize: 17, fontFamily: CJK, letterSpacing: 2,
                }}>
                ✓ 標記完成
              </button>
            </div>
          )
        })()}

        {/* 本場獄卒(2.1:頭貼 + 名稱) */}
        <div>
          <SectionLabel color={C.hazard}>本場獄卒（{guards.length}）</SectionLabel>
          {guards.length === 0 ? <div style={{ color: C.faint, fontSize: 20 }}>無</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
              {guards.map((g, i) => (
                <div key={i} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px 22px',
                }}>
                  <PersonAvatar profile={g.profile} size={120} />
                  <span style={{ fontSize: 21, fontWeight: 700 }}>{g.profile?.game_name ?? g.profile?.display_name ?? '?'}</span>
                  <span style={{
                    fontSize: 13, letterSpacing: 2, color: C.ok, border: '1px solid rgba(63,179,107,.4)',
                    borderRadius: 4, padding: '2px 10px',
                  }}>
                    {g.profile?.role === 'warden' ? '典獄長' : '獄卒'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 本場囚犯 */}
        <div>
          <SectionLabel color={C.alarm}>本場囚犯（{inmates.length}）</SectionLabel>
          {inmates.length === 0 ? <div style={{ color: C.faint, fontSize: 20 }}>本場還沒有囚犯</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
              {inmates.map((m, i) => (
                <div key={i} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 200,
                  background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px 12px',
                }}>
                  <PersonAvatar profile={m.profile} size={160} />
                  <span style={{ fontSize: 19, fontWeight: 700, textAlign: 'center' }}>{m.profile?.game_name ?? m.profile?.display_name ?? '?'}</span>
                  <span style={{ fontSize: 14, color: C.faint, fontFamily: MONO }}>No.{m.profile?.inmate_no != null ? String(m.profile.inmate_no).padStart(4, '0') : '----'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 底部:警示斜紋收尾 */}
      <div style={hazardStripe(10)} />
    </div>
  )
}
