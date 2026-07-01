import { supabase } from './supabaseClient'

// 送出預約:帶上目前登入者的 access token,身分由 /api/booking 伺服器端驗證。
// game_name / avatar_url 只作該筆預約的展示值(伺服器仍以 JWT 驗身分,不信任前端自報身分)。
// 回傳 { ok, status, error?, booked?, capacity? }
export async function createBooking(sessionId, { note = null, game_name = null, avatar_url = null, password = null, requested_slots = [], addons = [], capture = null } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, status: 401, error: 'not_authenticated' }
  const res = await fetch('/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: sessionId, note: note || null, game_name: game_name || null, avatar_url: avatar_url || null, password: password || null, requested_slots: requested_slots || [], addons: addons || [], capture: capture || null }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ...json }
}

// 不註冊預約:免登入,只留遊戲暱稱(伺服器端驗場次/容量/密鑰;同場同暱稱防重複)。
// 回傳 { ok, status, error?, booked?, capacity? }
export async function createGuestBooking(sessionId, { game_name, server = null, password = null, requested_slots = [], addons = [], capture = null } = {}) {
  const res = await fetch('/api/booking-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, game_name, server: server || null, password: password || null, requested_slots: requested_slots || [], addons: addons || [], capture: capture || null }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ...json }
}

// 取消自己的預約(沿用 RLS:本人可改自己的列)
export async function cancelBooking(bookingId) {
  const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
  return { ok: !error, error: error?.message }
}
