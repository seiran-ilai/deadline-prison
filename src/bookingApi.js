import { supabase } from './supabaseClient'

// 送出預約:帶上目前登入者的 access token,身分由 /api/booking 伺服器端驗證。
// game_name / avatar_url 只作該筆預約的展示值(伺服器仍以 JWT 驗身分,不信任前端自報身分)。
// 回傳 { ok, status, error?, booked?, capacity? }
export async function createBooking(sessionId, { note = null, game_name = null, avatar_url = null } = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, status: 401, error: 'not_authenticated' }
  const res = await fetch('/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ session_id: sessionId, note: note || null, game_name: game_name || null, avatar_url: avatar_url || null }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ...json }
}

// 取消自己的預約(沿用 RLS:本人可改自己的列)
export async function cancelBooking(bookingId) {
  const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
  return { ok: !error, error: error?.message }
}
