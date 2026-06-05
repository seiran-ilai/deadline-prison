import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { sessionPlan, pomodoroState } from '../pomodoro'

// 單一場次的番茄鐘控台(僅典獄長)。
// 吃一個 session 物件;單場就渲染一個,日後要同時控多場時直接 map 成每場一張卡即可。
// 用 <SessionTimerControl key={session.id} ... /> 讓切換場次時 roundsInput 等內部狀態自動重置。
export default function SessionTimerControl({ session, setMsg, reloadShared }) {
  const sessionId = session.id
  const [roundsInput, setRoundsInput] = useState(session.total_rounds ?? 8) // 番茄鐘專注輪數輸入(idle 用)

  // 每秒重算(讓 running 顯示的目前輪數與 −輪 下限即時推進)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [])

  async function saveRounds() {
    const n = Math.max(1, parseInt(roundsInput) || 1)
    const { error } = await supabase.from('sessions').update({ total_rounds: n }).eq('id', sessionId)
    if (error) { setMsg('儲存輪數失敗:' + error.message); return }
    setMsg('已設定專注輪數:' + n); reloadShared()
  }

  // 開始:idle → running(同時清掉收尾時間,以防重新開始)
  async function startTimer() {
    const { error } = await supabase.from('sessions')
      .update({ timer_started_at: new Date().toISOString(), timer_ended_at: null }).eq('id', sessionId)
    if (error) { setMsg('開始失敗:' + error.message); return }
    setMsg('已開始服刑'); reloadShared()
  }

  // 提早結束:running → ended(收尾)
  async function endTimer() {
    if (!window.confirm('確定提早結束本場?將立刻進入收尾')) return
    const { error } = await supabase.from('sessions')
      .update({ timer_ended_at: new Date().toISOString() }).eq('id', sessionId)
    if (error) { setMsg('結束失敗:' + error.message); return }
    setMsg('已提早結束本場'); reloadShared()
  }

  // 重新設定:任何狀態 → idle(清掉開始與結束時間)
  async function resetTimer() {
    if (!window.confirm('確定重新設定番茄鐘?將清掉開始與結束時間,全場回到等待狀態')) return
    const { error } = await supabase.from('sessions')
      .update({ timer_started_at: null, timer_ended_at: null }).eq('id', sessionId)
    if (error) { setMsg('重新設定失敗:' + error.message); return }
    setMsg('已重新設定番茄鐘'); reloadShared()
  }

  // 整場 ±輪:即時改 total_rounds;−輪 下限 = max(目前進行中的輪數, 1)
  async function changeRounds(delta) {
    const next = (session.total_rounds ?? 8) + delta
    if (next < roundFloor) { setMsg('不能少於目前進行中的輪數'); return }
    const { error } = await supabase.from('sessions').update({ total_rounds: next }).eq('id', sessionId)
    if (error) { setMsg('調整輪數失敗:' + error.message); return }
    setMsg(`已${delta > 0 ? '+' : '−'}1 輪,現為 ${next} 輪`); reloadShared()
  }

  const plan = sessionPlan(Math.max(1, parseInt(roundsInput) || 1))

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

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8, background: '#fff', color: '#222' }}>
      <strong>番茄鐘控制</strong>

      {/* idle:設定總輪數 + 開始 */}
      {timerStatus === 'idle' && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            專注輪數:
            <input type="number" min="1" value={roundsInput}
              onChange={e => setRoundsInput(e.target.value)}
              style={{ width: 64, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }} />
            <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}
              onClick={saveRounds}>儲存輪數</button>
            <span style={{ color: '#666', fontSize: 13 }}>
              預覽總時長:約 <strong>{plan.totalMinutes}</strong> 分(專注25×{plan.focusCount} + 放風5×{plan.normalBreakCount} + 長休15×{plan.longBreakCount})
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <button style={{ padding: '6px 16px', border: '1px solid #bbb', borderRadius: 4, background: '#eef4ff', color: '#333', cursor: 'pointer', fontWeight: 700 }}
              onClick={startTimer}>開始服刑</button>
          </div>
        </>
      )}

      {/* running:提早結束 / 重新設定 / +輪 / −輪 */}
      {timerStatus === 'running' && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#2a7' }}>● 服刑中 · 第 {curRound} 輪 / 共 {totalRounds} 輪</span>
          <span style={{ color: '#888', fontSize: 13 }}>開始於 {new Date(session.timer_started_at).toLocaleString()}</span>
          <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}
            onClick={() => changeRounds(1)}>＋輪</button>
          <button disabled={totalRounds <= roundFloor}
            style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: totalRounds <= roundFloor ? '#bbb' : '#333', cursor: totalRounds <= roundFloor ? 'not-allowed' : 'pointer' }}
            onClick={() => changeRounds(-1)}>−輪</button>
          <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
            onClick={endTimer}>提早結束</button>
          <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
            onClick={resetTimer}>重新設定</button>
        </div>
      )}

      {/* ended:收尾 + 重新設定 */}
      {timerStatus === 'ended' && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#666' }}>🔓 本場服刑結束(收尾)</span>
          <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
            onClick={resetTimer}>重新設定</button>
        </div>
      )}
    </div>
  )
}
