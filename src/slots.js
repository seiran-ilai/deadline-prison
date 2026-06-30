// 半小時時格工具:由場次 start_time('HH:MM' 或 'HH:MM:SS')與時格 index 算顯示標籤。
// 沒設開始時間 → 退回「第 N 節」。warden 排班與官網預約共用同一份。

export const SLOT_MINUTES = 30

function parseHm(s) {
  if (!s || typeof s !== 'string') return null
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

// index 0 = start_time;每段 +30 分。startTime 為空 → 「第 N 節」。
export function slotLabel(startTime, index) {
  const base = parseHm(startTime)
  if (base == null) return `第 ${index + 1} 節`
  const total = base + index * SLOT_MINUTES
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
