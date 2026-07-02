import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { pomodoroState, PHASE_LABEL, fmt } from './pomodoro'
import { normalizeStatus } from './warden/constants'
import { useTransitionBell } from './useTransitionBell'

// 計時器階段徽章配色(底色淡、文字濃)
const PHASE_BADGE = {
  focus: { bg: 'rgba(245,197,24,.16)', color: 'var(--hazard)' },
  break: { bg: 'rgba(63,179,107,.16)', color: 'var(--ok)' },
  longbreak: { bg: 'rgba(58,123,208,.18)', color: '#7fb0ea' },
}

// 等待 / 結束:同一個計時器框,只換內容(置中文字)
function TimerWaiting({ text, sub }) {
  return (
    <div className="ses-timer waiting">
      <div className="st-big">{text}</div>
      {sub && <div className="st-sub">{sub}</div>}
    </div>
  )
}

// 「服刑計時 / 狀態階段」:番茄鐘已開始顯示倒數,否則用現有資料推算當下階段文字
// 階段依「我這場的 role_in_session」分流(犯人/獄卒各一套),依序判斷。
// sessionProp:外部(如獄卒作業)直接給定「當前場次」,則不自載(改以該場次算番茄鐘/狀態)。
// 不給則沿用自載(犯人頁:依本人 session_inmates / 未取消預約判定所在場)。
export default function SessionStatus({ userId, session: sessionProp = undefined }) {
  const usingProp = sessionProp !== undefined
  const [loading, setLoading] = useState(!usingProp)
  // { session, role, hasGuard, hasInmates } 或 { session: null }(未報到)
  const [data, setData] = useState(null)
  const [, setTick] = useState(0)

  async function load() {
    // 1) 我有沒有報到進某 open 場次 + 我本場身分
    const { data: si } = await supabase.from('session_inmates')
      .select('id, session_id, role_in_session').eq('member_id', userId)
    let mineRow = null, sess = null
    if (si && si.length) {
      // 全撈 + normalizeStatus 過濾(多撈 status 算 displayStatus 用)
      const { data: rows } = await supabase.from('sessions')
        .select('id, title, status, timer_started_at, timer_ended_at, total_rounds, kind')
        .in('id', si.map(r => r.session_id))
      const live = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended')
      sess = live[0] ?? null
      if (sess) mineRow = si.find(r => r.session_id === sess.id)
    }
    // 自助入場:未報到但有未取消預約的 live 場 → 直接視為在場(免典獄長報到/身分核對)
    if (!sess) {
      const { data: bk } = await supabase.from('bookings')
        .select('session_id').eq('user_id', userId).neq('status', 'cancelled')
      if (bk && bk.length) {
        const { data: rows } = await supabase.from('sessions')
          .select('id, title, status, timer_started_at, timer_ended_at, total_rounds, kind')
          .in('id', bk.map(b => b.session_id))
        const live = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended')
        sess = live[0] ?? null
        if (sess) mineRow = { id: null, role_in_session: 'inmate' }   // 合成:僅供顯示
      }
    }
    if (!mineRow) { setData({ session: null }); setLoading(false); return }

    const role = mineRow.role_in_session
    let hasGuard = false, hasInmates = false
    if (role === 'guard') {
      // 本場是否有指派給我的犯人:本場犯人 row → inmate_guards(guard_id=我)
      const { data: roster } = await supabase.from('session_inmates')
        .select('id, role_in_session').eq('session_id', sess.id)
      const inmateRowIds = (roster ?? []).filter(r => r.role_in_session !== 'guard').map(r => r.id)
      if (inmateRowIds.length) {
        const { data: igs } = await supabase.from('inmate_guards')
          .select('id, session_inmate_id').eq('guard_id', userId).in('session_inmate_id', inmateRowIds)
        hasInmates = !!(igs && igs.length)
      }
    } else {
      // 犯人:我有沒有專屬獄卒
      const { data: igs } = await supabase.from('inmate_guards')
        .select('id').eq('session_inmate_id', mineRow.id)
      hasGuard = !!(igs && igs.length)
    }
    setData({ session: sess, role, hasGuard, hasInmates })
    setLoading(false)
  }

  // 每 10 秒重抓狀態(接收典獄長報到/指派/開始/重置)。外部已給場次則不自載。
  useEffect(() => {
    if (usingProp || !userId) return
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [userId, usingProp])

  // 每秒重算倒數(純前端,不打 DB)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 番茄鐘階段切換鈴聲(本人裝置):階段或輪次一變就響。
  // hook 必須在任何 early return 之前;bellKey 由 data 安全推算(尚未開始/已結束 → null 不響)。
  const bellSess = usingProp ? sessionProp : data?.session
  const bellSt = bellSess?.timer_started_at && !bellSess?.timer_ended_at
    ? pomodoroState(Math.floor((Date.now() - new Date(bellSess.timer_started_at).getTime()) / 1000), bellSess.total_rounds ?? 4, bellSess.timer_ended_at)
    : null
  const { armed: bellArmed, arm: armBell } = useTransitionBell(bellSt && !bellSt.ended ? `${bellSt.phase}-${bellSt.round}` : null)

  // 防呆:userId 尚未就緒(首次登入流程)時不掛載狀態卡
  if (!userId) return null
  if (loading) return <div className="ses-timer waiting"><div className="st-sub">讀取本場狀態中…</div></div>
  const session = usingProp ? sessionProp : data?.session

  // 鈴聲啟用鈕(尚未啟用才顯示;瀏覽器需先點一次才能自動播放)
  const bellBtn = !bellArmed ? (
    <button onClick={armBell} style={{
      display: 'block', margin: '10px auto 0', cursor: 'pointer', fontSize: 13, letterSpacing: 1,
      background: 'transparent', border: '1px solid var(--hazard)', color: 'var(--hazard)',
      borderRadius: 6, padding: '6px 14px',
    }}>🔔 點我啟用切換鈴聲</button>
  ) : null

  // 階段1:沒有任何未結束場次可服刑
  if (!session) return <TimerWaiting text="尚未加入場次" sub="報名場次後將自動帶入" />

  // 狀態一律看 normalizeStatus,不再用 timer_started_at 有無當狀態判斷
  const ds = normalizeStatus(session)

  // 指名互動 / 自由入場:不需要番茄鐘,只顯示本場狀態
  if (session.kind === 'named' || session.kind === 'free') {
    const kindTxt = session.kind === 'named' ? '指名互動' : '自由入場'
    const t = ds === 'ended' ? '本場已結束' : ds === 'serving' ? `${kindTxt}進行中` : '等待開始服刑'
    return <TimerWaiting text={t} sub={`本場：${session.title}（${kindTxt} · 無番茄鐘）`} />
  }

  // ended:理論上犯人頁外層會擋,保險起見顯示收尾文字
  if (ds === 'ended') return <TimerWaiting text="本場已結束" sub={`本場：${session.title}`} />

  // 尚未開始服刑(booking / booking_paused / intake 殘留):報名即可進頁,先等待 + 預先啟用鈴聲。
  if (ds !== 'serving') {
    return <>
      <TimerWaiting text="等待開始服刑" sub={`本場：${session.title}`} />
      {bellBtn}
    </>
  }

  // serving:番茄鐘倒數(timer_started_at 只在此拿來算倒數)
  const N = session.total_rounds ?? 4
  const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
  const st = pomodoroState(elapsed, N, session.timer_ended_at)
  if (st.ended) {
    return <TimerWaiting text="🔓 本場服刑結束" sub={`本場：${session.title} · 共 ${N} 輪 已全部完成`} />
  }
  const badge = PHASE_BADGE[st.phase] ?? PHASE_BADGE.focus
  return (
    <>
      <div className={`ses-timer${st.phase === 'focus' ? ' focus' : ''}`}>
        <div className="st-phase">
          <span className="st-badge" style={{ background: badge.bg, color: badge.color }}>{PHASE_LABEL[st.phase]}</span>
          <span className="st-round">第 {st.round} / {N} 輪</span>
        </div>
        <div className="st-clock">{fmt(st.remainingSeconds)}</div>
        <div className="st-dots">
          {Array.from({ length: N }, (_, i) => {
            const n = i + 1
            const cls = n < st.round ? 'done' : n === st.round ? 'cur' : ''
            return <i key={n} className={cls} />
          })}
        </div>
      </div>
      {bellBtn}
    </>
  )
}
