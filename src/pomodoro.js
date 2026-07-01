// 自動番茄鐘計算(純函式,可單獨測試)
// 節奏:專注25分 →(非最後一輪)放風5分;每第 8 輪後改放長休息15分(即需排到第 8 輪才會出現長休);
//       最後一輪專注後直接結束。預設 4 輪(未達 8 輪 → 全程只有 5 分放風,無長休)。

export const FOCUS = 25 * 60      // 1500s
export const BREAK = 5 * 60       // 300s
export const LONGBREAK = 15 * 60  // 900s

export const PHASE_LABEL = {
  focus: '服刑中',
  break: '放風',
  longbreak: '長休息',
  ended: '本場服刑結束',
}

// 同囚 presence 用的狀態文字
export function presenceLabel(timerStartedAt, totalRounds, timerEndedAt) {
  if (!timerStartedAt) return '等待中'
  if (timerEndedAt) return '服刑完畢'
  const elapsed = Math.floor((Date.now() - new Date(timerStartedAt).getTime()) / 1000)
  const st = pomodoroState(elapsed, totalRounds)
  if (st.ended) return '服刑完畢'
  return st.phase === 'focus' ? '服刑中' : '放風中'
}

// 給定已過秒數與總輪數,推算當下狀態
// 回傳 { phase: 'focus'|'break'|'longbreak'|'ended', round, remainingSeconds, ended }
// timerEndedAt 有值 = 典獄長提早結束 → 直接收尾(優先於自然計算)
export function pomodoroState(elapsedSeconds, totalRounds, timerEndedAt = null) {
  const N = Math.max(1, totalRounds ?? 4)
  if (timerEndedAt) return { phase: 'ended', round: N, remainingSeconds: 0, ended: true }
  let t = Math.max(0, Math.floor(elapsedSeconds))
  for (let i = 1; i <= N; i++) {
    // 專注段
    if (t < FOCUS) return { phase: 'focus', round: i, remainingSeconds: FOCUS - t, ended: false }
    t -= FOCUS
    // 最後一輪專注結束 → 收尾,不放休息
    if (i === N) break
    // 休息段:每 8 輪後長休,其餘放風
    const isLong = i % 8 === 0
    const dur = isLong ? LONGBREAK : BREAK
    if (t < dur) return { phase: isLong ? 'longbreak' : 'break', round: i, remainingSeconds: dur - t, ended: false }
    t -= dur
  }
  return { phase: 'ended', round: N, remainingSeconds: 0, ended: true }
}

// 開場預覽:輪數 → 各段次數與總時長
export function sessionPlan(totalRounds) {
  const N = Math.max(1, totalRounds ?? 4)
  const longBreakCount = Math.floor((N - 1) / 8)
  const normalBreakCount = (N - 1) - longBreakCount
  const totalSeconds = FOCUS * N + BREAK * normalBreakCount + LONGBREAK * longBreakCount
  return { focusCount: N, normalBreakCount, longBreakCount, totalSeconds, totalMinutes: Math.round(totalSeconds / 60) }
}

// 秒數 → 「分:秒」
export function fmt(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
