import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { pomodoroState, PHASE_LABEL, fmt } from './pomodoro'

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
export default function SessionStatus({ userId }) {
  const [loading, setLoading] = useState(true)
  // { session, role, hasGuard, hasInmates } 或 { session: null }(未報到)
  const [data, setData] = useState(null)
  const [, setTick] = useState(0)

  async function load() {
    // 1) 我有沒有報到進某 open 場次 + 我本場身分
    const { data: si } = await supabase.from('session_inmates')
      .select('id, session_id, role_in_session').eq('member_id', userId)
    let mineRow = null, sess = null
    if (si && si.length) {
      const { data: open } = await supabase.from('sessions')
        .select('id, title, timer_started_at, timer_ended_at, total_rounds')
        .in('id', si.map(r => r.session_id)).eq('status', 'open')
      if (open && open.length) { sess = open[0]; mineRow = si.find(r => r.session_id === sess.id) }
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

  // 每 10 秒重抓狀態(接收典獄長報到/指派/開始/重置)
  useEffect(() => {
    if (!userId) return
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [userId])

  // 每秒重算倒數(純前端,不打 DB)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  if (loading) return <div className="ses-timer waiting"><div className="st-sub">讀取本場狀態中…</div></div>
  const { session, role, hasGuard, hasInmates } = data

  // 階段1:還沒報到進任何 open 場次 → 統一文字
  if (!session) return <TimerWaiting text="等待身分核對" sub="尚未被報到進任何場次,請等典獄長報到" />

  // 階段2/3:番茄鐘尚未開始,依本場身分顯示對應等待文字(依序判斷)
  if (!session.timer_started_at) {
    if (role === 'guard') {
      return <TimerWaiting text={hasInmates ? '等待服刑開始' : '監管犯人配對中'} sub={`本場:${session.title}`} />
    }
    return <TimerWaiting text={hasGuard ? '等待服刑開始' : '等待配對專屬獄卒'} sub={`本場:${session.title}`} />
  }

  // 階段4:番茄鐘已開始 → 顯示倒數
  const N = session.total_rounds ?? 8
  const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
  const st = pomodoroState(elapsed, N, session.timer_ended_at)
  if (st.ended) {
    return <TimerWaiting text="🔓 本場服刑結束" sub={`本場:${session.title} · 共 ${N} 輪 已全部完成`} />
  }
  const badge = PHASE_BADGE[st.phase] ?? PHASE_BADGE.focus
  return (
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
  )
}
