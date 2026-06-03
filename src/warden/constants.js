import { pomodoroState, PHASE_LABEL } from '../pomodoro'

export const ROLE_LABEL = { member: '犯人', guard: '獄卒', warden: '典獄長' }

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
  const st = pomodoroState(elapsed, sess.total_rounds ?? 8)
  return st.ended ? '已結束' : PHASE_LABEL[st.phase]
}
