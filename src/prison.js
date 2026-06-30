// 形象官網純函式(可單測):場次狀態判定 + RPC 列轉前台視圖。

// SessStatus: 'open' | 'full' | 'ended'
export function sessionStatus(s, now = new Date()) {
  const d = new Date(s.dateISO + 'T00:00:00')
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  if (s.dateISO && d < today) return 'ended'
  if (s.capacity > 0 && s.booked >= s.capacity) return 'full'
  return 'open'
}

// public_sessions() 回的列 → 前台場次視圖。
// capacity 保留 null(= 不限人數,不可改寫成 0,否則「不限」會被誤判為已額滿)。
// display_status / can_book 由後端轉好,前端一律以此為準(不再用 timer 自行判斷)。
export function toSessionView(r) {
  const dateISO = r.session_date ? String(r.session_date).slice(0, 10) : ''
  const mmdd = dateISO ? dateISO.slice(5).replace('-', '') : ''
  return {
    id: r.id,
    batch: mmdd ? `BATCH-${mmdd}` : ('NO-' + String(r.id).slice(0, 8).toUpperCase()),
    title: r.title,
    dateISO,
    booked: r.booked ?? 0,
    capacity: r.capacity ?? null,
    displayStatus: r.display_status,
    canBook: r.can_book === true,
    hasPassword: r.has_password === true,   // 密鑰場:報名前須通過密鑰核對
    kind: r.kind ?? 'crunch',               // 場次類型(僅標籤);缺值視為集體趕稿
  }
}

// 顯示用:YYYY-MM-DD → { dd, mm }(mm 含年:YYYY.MM)
export function splitDate(dateISO) {
  if (!dateISO) return { dd: '--', mm: '----' }
  const d = new Date(dateISO + 'T00:00:00')
  return {
    dd: String(d.getDate()).padStart(2, '0'),
    mm: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`,
  }
}
