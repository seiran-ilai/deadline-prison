import { pomodoroState, PHASE_LABEL } from '../pomodoro'

export const ROLE_LABEL = { member: '犯人', guard: '獄卒', warden: '典獄長' }

// materialize_session_bookings 回傳的跳過名單 → 提示訊息。
// 有跳過者逐筆說明(在別場未結束無法帶入);無則回「已帶入預約名單」。
export function materializeResultMsg(skipped) {
  if (skipped && skipped.length)
    return skipped.map(s => `「${s.skipped_name} 還在場次「${s.other_session}」，無法帶入本場」`).join('、')
  return '已帶入預約名單'
}

// 場次五態:單一真相 sessions.status。
// 過渡期 DB 可能仍有舊值 open/closed,前端讀到先正規化再判斷顯示。
// 番茄鐘 timer_started_at/timer_ended_at 從此只是「serving 內的計時資料」,不再反推場次狀態。
export function normalizeStatus(s) {
  // 防呆:s 為 null/undefined 或 status 不存在 → 視為 'ended'(最安全:不會誤判為在某場服刑中)
  if (!s || s.status == null) return 'ended'
  if (s.status === 'open') return s.timer_started_at ? 'serving' : 'booking'
  if (s.status === 'closed') return 'ended'
  return s.status   // 已是新值
}

export const SESSION_STATUS_LABEL = {
  booking: '預約中',
  booking_paused: '停止預約',
  intake: '開始入場',
  serving: '服刑中',
  ended: '已結束',
}

export const OVERVIEW_STATUS_STYLE = {
  '服刑中': { bg: '#d9534f', color: '#fff' },
  '放風': { bg: '#2a8', color: '#fff' },
  '長休息': { bg: '#3a7bd0', color: '#fff' },
  '在場待命': { bg: '#e08e0b', color: '#fff' },
  '已結束': { bg: '#666', color: '#fff' },
  '不在場': { bg: '#eee', color: '#888' },
}

// 總覽「目前狀態」:依該人所在 open 場次的番茄鐘算(快照,開啟時算一次)
export function memberStatusLabel(sess) {
  if (!sess) return '不在場'
  if (!sess.timer_started_at) return '在場待命'
  const elapsed = Math.floor((Date.now() - new Date(sess.timer_started_at).getTime()) / 1000)
  const st = pomodoroState(elapsed, sess.total_rounds ?? 4, sess.timer_ended_at)
  return st.ended ? '已結束' : PHASE_LABEL[st.phase]
}
