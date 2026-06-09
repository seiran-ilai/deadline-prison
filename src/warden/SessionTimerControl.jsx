import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { pomodoroState } from '../pomodoro'

// 單一場次的番茄鐘控台(僅典獄長)。容器層只在「場次 = serving」時才 render(見 SessionTab)。
// 「開始服刑」已移到「場次總覽」狀態機(intake→serving),轉 serving 時後端自動設 timer_started_at,
// 故本元件不再有 idle 的「開始服刑」UI。番茄鐘只是 serving 狀態內的計時資料。
// 用 <SessionTimerControl key={session.id} ... /> 讓切換場次時內部計時狀態自動重置。
export default function SessionTimerControl({ session, setMsg, reloadShared }) {
  const sessionId = session.id

  // 每秒重算(讓 running 顯示的目前輪數與 −輪 下限即時推進)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // 提早結束:serving → ended(走場次狀態機,不直接動 timer_*)
  async function endTimer() {
    if (!window.confirm('確定結束本場服刑?結束後不可重開')) return
    const { error } = await supabase.rpc('set_session_status', { p_session: sessionId, p_new_status: 'ended' })
    if (error) { setMsg('結束失敗:' + error.message); return }
    setMsg('已結束服刑'); reloadShared()
  }

  // 退回入場:serving → intake(後端轉 intake 時會自動清掉番茄鐘計時)
  async function resetTimer() {
    if (!window.confirm('將清掉番茄鐘計時、退回入場狀態,全場回到等待')) return
    const { error } = await supabase.rpc('set_session_status', { p_session: sessionId, p_new_status: 'intake' })
    if (error) { setMsg('退回入場失敗:' + error.message); return }
    setMsg('已退回入場'); reloadShared()
  }

  // 整場 ±輪:即時改 total_rounds;−輪 下限 = max(目前進行中的輪數, 1)
  async function changeRounds(delta) {
    const next = (session.total_rounds ?? 8) + delta
    if (next < roundFloor) { setMsg('不能少於目前進行中的輪數'); return }
    const { error } = await supabase.from('sessions').update({ total_rounds: next }).eq('id', sessionId)
    if (error) { setMsg('調整輪數失敗:' + error.message); return }
    setMsg(`已${delta > 0 ? '+' : '−'}1 輪,現為 ${next} 輪`); reloadShared()
  }

  // 番茄鐘狀態(與直播大螢幕、犯人手機共用同一純函式)
  const totalRounds = session.total_rounds ?? 8
  let timerStatus = 'idle'   // idle | running | ended
  let curRound = 1
  if (session.timer_started_at) {
    const elapsed = Math.floor((Date.now() - new Date(session.timer_started_at).getTime()) / 1000)
    const st = pomodoroState(elapsed, totalRounds, session.timer_ended_at)
    curRound = st.round
    timerStatus = st.ended ? 'ended' : 'running'
  }
  const roundFloor = Math.max(curRound, 1)  // −輪 下限

  // 整合進場次控制條:番茄鐘狀態做為一個 .seg,主要動作放右側 .go
  return (
    <>
      {/* running:狀態 + ±輪 / 提早結束(轉 ended)/ 退回入場(轉 intake) */}
      {timerStatus === 'running' && (
        <>
          <div className="seg">
            <span className="lbl">番茄鐘</span>
            <div className="row timer-state">
              <span className="running">● 服刑中 · 第 {curRound} 輪 / 共 {totalRounds} 輪</span>
              <button className="btn-sm" onClick={() => changeRounds(1)}>＋輪</button>
              <button className="btn-sm" disabled={totalRounds <= roundFloor} onClick={() => changeRounds(-1)}>−輪</button>
            </div>
            <span className="pomo-prev">開始於 {new Date(session.timer_started_at).toLocaleString()}</span>
          </div>
          <div className="go">
            <button className="btn-danger btn-sm" onClick={endTimer}>提早結束</button>
            <button className="btn-danger btn-sm" onClick={resetTimer}>退回入場</button>
          </div>
        </>
      )}

      {/* ended(番茄鐘算完):不自動轉場次狀態,只提示收尾並提供按鈕 */}
      {timerStatus === 'ended' && (
        <>
          <div className="seg">
            <span className="lbl">番茄鐘</span>
            <div className="row timer-state"><span className="ended">🔓 本場服刑結束(收尾中,請按下方『結束服刑』)</span></div>
          </div>
          <div className="go">
            <button className="btn-danger btn-sm" onClick={endTimer}>結束服刑</button>
            <button className="btn-danger btn-sm" onClick={resetTimer}>退回入場(清番茄鐘)</button>
          </div>
        </>
      )}

      {/* idle:serving 理論上必有 timer_started_at;遇到代表資料異常,僅提示不提供開始鈕 */}
      {timerStatus === 'idle' && (
        <div className="seg">
          <span className="lbl">番茄鐘</span>
          <div className="row timer-state"><span className="muted">計時未啟動</span></div>
        </div>
      )}
    </>
  )
}
