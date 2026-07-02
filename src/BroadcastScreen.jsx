import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { pomodoroState, PHASE_LABEL, fmt, FOCUS, BREAK, LONGBREAK } from './pomodoro'
import { useTransitionBell } from './useTransitionBell'

// 直播大螢幕:獨立視窗(不在 .admin 底下),為 1920×1080 投放設計。
// 版面(上→下):警示斜紋 / 標題列 / 大鐘 + 階段進度條 + 輪次刻度(主角,置中) / 本場獄卒列 / 警示斜紋。
// 犯人不顯示;探監廣播改右上角跳出式訊息卡輪播;獄卒超過 5 人自動跑馬燈(右→左循環)。
const C = {
  bg: '#0c0d0f', panel: '#15171b', line: 'rgba(255,255,255,.08)',
  text: '#e4e5e7', dim: '#9298a2', faint: '#5a606a',
  hazard: '#f5c518', hazardDeep: '#caa00f', alarm: '#d8412f', ok: '#3fb36b',
}
const MONO = "'Space Mono', 'Noto Sans TC', monospace"   // 中文需先命中 Noto,否則被通用 monospace 攔走變新細明體
const CJK = "'Noto Sans TC', sans-serif"

// 階段配色(底淡字濃,與主控台計時器一致)+ 各階段總秒數(算進度條)
const PHASE_STYLE = {
  focus: { bg: 'rgba(245,197,24,.16)', color: C.hazard, bar: C.hazard },
  break: { bg: 'rgba(63,179,107,.16)', color: C.ok, bar: C.ok },
  longbreak: { bg: 'rgba(58,123,208,.18)', color: '#7fb0ea', bar: '#3a7bd0' },
}
const PHASE_SECONDS = { focus: FOCUS, break: BREAK, longbreak: LONGBREAK }

// 動畫/跑馬燈 keyframes(此頁不吃 admin.css,樣式自帶;reduced-motion 一併降級)
const STYLE = `
@keyframes bc-toast-in{from{opacity:0;transform:translateX(48px)}to{opacity:1;transform:none}}
@keyframes bc-blink{0%,55%{opacity:1}56%,100%{opacity:.2}}
@keyframes bc-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.bc-marquee{display:flex;width:max-content;animation:bc-marquee var(--bc-dur,30s) linear infinite}
@media (prefers-reduced-motion:reduce){
  .bc-marquee{animation:none!important}
  .bc-toast{animation:none!important}
  .bc-live-dot{animation:none!important}
}
`

// 黃黑警示斜紋條
const hazardStripe = (h = 12) => ({
  height: h, flex: '0 0 auto',
  background: 'repeating-linear-gradient(45deg,#f5c518 0 20px,#0a0a0a 20px 40px)',
})

// 方形拘留照頭貼(有照片用照片,無照片用首字)
function PersonAvatar({ profile, size }) {
  const name = profile?.game_name ?? profile?.display_name ?? ''
  const initial = name ? name[0] : (profile?.inmate_no != null ? String(profile.inmate_no).slice(-2) : '?')
  return (
    <div style={{
      width: size, height: size, borderRadius: 12, overflow: 'hidden', flex: '0 0 auto',
      border: `1px solid ${C.line}`, background: '#1d2127',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: C.dim, fontFamily: MONO, fontWeight: 700, fontSize: size * 0.34,
    }}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : initial}
    </div>
  )
}

// 獄卒卡(靜態列與跑馬燈共用)
function GuardCard({ profile }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
      background: C.panel, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.hazardDeep}`,
      borderRadius: 12, padding: '16px 24px', flex: '0 0 auto',
    }}>
      <PersonAvatar profile={profile} size={130} />
      <span style={{ fontSize: 21, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {profile?.game_name ?? profile?.display_name ?? '?'}
      </span>
      <span style={{
        fontSize: 13, letterSpacing: 2, color: C.ok,
        border: '1px solid rgba(63,179,107,.4)', borderRadius: 4, padding: '1px 10px',
      }}>
        {profile?.role === 'warden' ? '典獄長' : '獄卒'}
      </span>
    </div>
  )
}

export default function BroadcastScreen({ sessionId }) {
  const [session, setSession] = useState(null)  // { title, timer_started_at, total_rounds }
  const [guards, setGuards] = useState([])
  const [visits, setVisits] = useState([])      // 本場未完成廣播(新→舊;標記完成即退出輪播)
  const [visitIdx, setVisitIdx] = useState(0)   // 廣播輪播目前索引
  const [profById, setProfById] = useState({})  // 廣播對象名字解析(犯人不上畫面,仍需顯示名)
  const [notFound, setNotFound] = useState(false)
  const [, setTick] = useState(0)

  // 場次 + 名單(每 10 秒輪詢,接收計時開始/晚進場/標記完成)
  async function loadData() {
    const { data: sess } = await supabase.from('sessions')
      .select('title, timer_started_at, timer_ended_at, total_rounds').eq('id', sessionId).single()
    if (!sess) { setNotFound(true); return }
    setSession(sess)
    // 本場廣播:只取未完成(is_done=false);完成的留在紀錄,不再輪播
    const { data: vs } = await supabase.from('visits')
      .select('id, inmate_id, guard_id, visitor_name, message, created_at')
      .eq('session_id', sessionId).eq('is_done', false).order('created_at', { ascending: false })
    setVisits(vs ?? [])
    const { data: si } = await supabase.from('session_inmates')
      .select('member_id, role_in_session').eq('session_id', sessionId)
    const memberIds = (si ?? []).map(r => r.member_id)
    // 廣播卡要顯示犯人/指定獄卒名,一併把廣播相關 id 撈進名字快取
    const visitIds = (vs ?? []).flatMap(v => [v.inmate_id, v.guard_id]).filter(Boolean)
    const allIds = [...new Set([...memberIds, ...visitIds])]
    if (!allIds.length) { setGuards([]); setProfById({}); return }
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', allIds)
    const byId = {}; for (const p of profs ?? []) byId[p.id] = p
    setProfById(byId)
    setGuards((si ?? []).filter(r => r.role_in_session === 'guard').map(r => ({ profile: byId[r.member_id] })))
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

  // 廣播輪播:多筆時每 7 秒切下一筆;一筆固定、零筆不顯示(modulo 容忍筆數變動)
  useEffect(() => {
    if (visits.length <= 1) return
    const t = setInterval(() => setVisitIdx(i => (i + 1) % visits.length), 7000)
    return () => clearInterval(t)
  }, [visits.length])

  // 番茄鐘階段切換鈴聲(大螢幕):階段或輪次一變就響;尚未開始/已結束不響。
  // 每秒的 setTick 會驅動重算,故 bellKey 會即時反映切換。
  const bellSt = session?.timer_started_at && !session?.timer_ended_at
    ? pomodoroState(Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000), session.total_rounds ?? 4, session.timer_ended_at)
    : null
  const bellKey = bellSt && !bellSt.ended ? `${bellSt.phase}-${bellSt.round}` : null
  const { armed: bellArmed, arm: armBell } = useTransitionBell(bellKey)

  // 標記完成:結束這則廣播在大螢幕/犯人頁/獄卒頁的輪播(此視窗為典獄長開啟,沿用其權限)
  async function markVisitDone(v) {
    const { error } = await supabase.from('visits').update({ is_done: true }).eq('id', v.id)
    if (error) { window.alert('標記失敗：' + error.message); return }
    loadData()
  }

  const screen = {
    height: '100vh', overflow: 'hidden', background: C.bg, color: C.text, fontFamily: CJK,
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', position: 'relative',
  }

  if (notFound) return <div style={{ ...screen, justifyContent: 'center', alignItems: 'center' }}>查無此場次</div>
  if (!session) return <div style={{ ...screen, justifyContent: 'center', alignItems: 'center' }}>讀取中…</div>

  // ===== 計時主區(大鐘 + 階段進度條 + 輪次刻度)=====
  const N = session.total_rounds ?? 4
  let timerBlock
  if (!session.timer_started_at) {
    timerBlock = <div style={{ fontSize: 54, color: C.dim, letterSpacing: 6 }}>尚未開始服刑</div>
  } else {
    const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
    const st = pomodoroState(elapsed, N, session.timer_ended_at)
    if (st.ended) {
      timerBlock = <div style={{ fontSize: 80, fontWeight: 900, letterSpacing: 6 }}>🔓 本場服刑結束</div>
    } else {
      const ps = PHASE_STYLE[st.phase] ?? PHASE_STYLE.focus
      const dur = PHASE_SECONDS[st.phase] ?? FOCUS
      const pct = Math.max(0, Math.min(100, (1 - st.remainingSeconds / dur) * 100))
      const barW = 'min(880px, 62vw)'
      timerBlock = (
        <>
          {/* 階段徽章 + 輪次 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <span style={{
              padding: '10px 34px', borderRadius: 8, fontSize: 34, fontWeight: 700,
              letterSpacing: 8, background: ps.bg, color: ps.color,
            }}>
              {PHASE_LABEL[st.phase]}
            </span>
            <span style={{ fontSize: 30, color: C.dim, fontFamily: MONO, letterSpacing: 2 }}>
              第 <b style={{ color: C.text }}>{st.round}</b> / {N} 輪
            </span>
          </div>
          {/* 大鐘 */}
          <div style={{
            fontSize: 'clamp(150px, 24vh, 280px)', fontWeight: 700, lineHeight: 1, letterSpacing: 10,
            fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
            textShadow: st.phase === 'focus' ? '0 0 90px rgba(245,197,24,.25)' : 'none',
          }}>
            {fmt(st.remainingSeconds)}
          </div>
          {/* 目前階段進度條(黃黑斜紋填充) */}
          <div style={{
            width: barW, height: 24, borderRadius: 6, overflow: 'hidden',
            background: 'rgba(255,255,255,.07)', border: `1px solid ${C.line}`,
          }}>
            <div style={{
              width: `${pct}%`, height: '100%', transition: 'width 1s linear',
              background: st.phase === 'focus'
                ? 'repeating-linear-gradient(45deg,#f5c518 0 14px,#caa00f 14px 28px)'
                : ps.bar,
            }} />
          </div>
          {/* 輪次刻度(已完成=深黃/目前=亮黃/未到=暗格) */}
          <div style={{ width: barW, display: 'flex', gap: 8 }}>
            {Array.from({ length: N }, (_, i) => {
              const n = i + 1
              const bg = n < st.round ? C.hazardDeep
                : n === st.round ? C.hazard
                  : 'rgba(255,255,255,.1)'
              const glow = n === st.round ? { boxShadow: '0 0 14px rgba(245,197,24,.55)' } : {}
              return <i key={n} style={{ flex: 1, height: 10, borderRadius: 5, background: bg, ...glow }} />
            })}
          </div>
        </>
      )
    }
  }

  // ===== 廣播跳出訊息卡(右上;輪播未完成廣播)=====
  const v = visits.length ? visits[visitIdx % visits.length] : null
  const toast = v && (() => {
    const ip = profById[v.inmate_id]
    const inmateName = ip?.game_name ?? ip?.display_name ?? '某囚'
    const no = ip?.inmate_no != null ? String(ip.inmate_no).padStart(4, '0') : '----'
    const gp = v.guard_id ? profById[v.guard_id] : null
    const guardName = v.guard_id ? (gp?.game_name ?? gp?.display_name ?? null) : null
    return (
      <div key={v.id} className="bc-toast" style={{
        position: 'fixed', top: 86, right: 44, zIndex: 10, width: 'min(560px, 38vw)',
        background: 'linear-gradient(135deg,#241a35,#15131c)', border: '1px solid #b56fd9',
        borderLeft: '5px solid #b56fd9', borderRadius: 14, padding: '20px 24px',
        boxShadow: '0 14px 50px rgba(0,0,0,.55)', animation: 'bc-toast-in .45s ease-out both',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 16, color: '#c89be0', letterSpacing: 4, fontFamily: MONO }}>
            💌 探監廣播{visits.length > 1 ? ` · ${(visitIdx % visits.length) + 1} / ${visits.length}` : ''}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => markVisitDone(v)}
            style={{
              cursor: 'pointer', background: 'transparent', border: '1px solid #b56fd9',
              color: '#c89be0', borderRadius: 6, padding: '6px 14px', fontSize: 14,
              fontFamily: CJK, letterSpacing: 1, whiteSpace: 'nowrap',
            }}>
            ✓ 標記完成
          </button>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.4 }}>
          〈{v.visitor_name}〉 探望 <span style={{ color: C.hazard }}>No.{no} {inmateName}</span>
        </div>
        <div style={{ fontSize: 21, marginTop: 6, lineHeight: 1.5 }}>「{v.message}」</div>
        {guardName && <div style={{ fontSize: 17, color: '#9bd0a8', marginTop: 8 }}>🛡 指定獄卒：{guardName}</div>}
      </div>
    )
  })()

  // ===== 獄卒列(>5 人自動跑馬燈,右→左循環;reduced-motion 降級為靜態)=====
  const marquee = guards.length > 5
  const guardRow = guards.length === 0
    ? <div style={{ color: C.faint, fontSize: 22, textAlign: 'center' }}>本場目前沒有獄卒在場</div>
    : marquee
      ? (
        <div style={{ overflow: 'hidden', width: '100%' }}>
          {/* 列表渲染兩份,位移 -50% 後無縫接回起點;時長隨人數放大保持等速 */}
          <div className="bc-marquee" style={{ gap: 26, paddingRight: 26, '--bc-dur': `${Math.max(24, guards.length * 5)}s` }}>
            {[...guards, ...guards].map((g, i) => <GuardCard key={i} profile={g.profile} />)}
          </div>
        </div>
      )
      : (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 26, flexWrap: 'nowrap' }}>
          {guards.map((g, i) => <GuardCard key={i} profile={g.profile} />)}
        </div>
      )

  return (
    <div style={screen}>
      <style>{STYLE}</style>

      {/* 頂部:警示斜紋 + 標題列 */}
      <div style={hazardStripe(12)} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '16px 44px 0' }}>
        <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 3 }}>死線<b style={{ color: C.hazard }}>監獄</b></span>
        <span style={{ fontSize: 14, color: C.faint, fontFamily: MONO, letterSpacing: 3 }}>DEADLINE PRISON</span>
        <span style={{ fontSize: 24, color: C.dim }}>｜ {session.title}</span>
        <span style={{ flex: 1 }} />
        {/* 鈴聲開關:瀏覽器需先點一次才能自動播放;armed 後顯示已啟用 */}
        <button onClick={armBell} disabled={bellArmed} title="番茄鐘切換階段時響鈴（需先點一次解鎖）"
          style={{
            cursor: bellArmed ? 'default' : 'pointer', fontFamily: CJK, fontSize: 15, letterSpacing: 1,
            borderRadius: 6, padding: '6px 14px', whiteSpace: 'nowrap',
            border: `1px solid ${bellArmed ? C.line : C.hazard}`,
            background: 'transparent', color: bellArmed ? C.faint : C.hazard,
          }}>
          {bellArmed ? '🔔 鈴聲已啟用' : '🔔 點我啟用鈴聲'}
        </button>
        <span className="bc-live-dot" style={{
          width: 12, height: 12, borderRadius: '50%', background: C.alarm,
          boxShadow: `0 0 10px ${C.alarm}`, animation: 'bc-blink 1.2s steps(1,end) infinite',
        }} />
        <span style={{ fontSize: 18, color: C.alarm, fontFamily: MONO, letterSpacing: 5 }}>LIVE</span>
      </div>

      {/* 中央:計時主區 */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 30,
      }}>
        {timerBlock}
      </div>

      {/* 底部:本場獄卒 */}
      <div style={{ flex: '0 0 auto', padding: '0 44px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
          <span style={{ fontSize: 22, letterSpacing: 5, color: C.hazard, fontWeight: 700, whiteSpace: 'nowrap' }}>
            本場獄卒（{guards.length}）
          </span>
          <span style={{ flex: 1, height: 1, background: C.line }} />
          <span style={{ fontSize: 13, color: C.faint, fontFamily: MONO, letterSpacing: 3 }}>GUARDS ON DUTY</span>
        </div>
        {guardRow}
      </div>
      <div style={hazardStripe(12)} />

      {/* 廣播跳出訊息(右上,固定浮層) */}
      {toast}
    </div>
  )
}
