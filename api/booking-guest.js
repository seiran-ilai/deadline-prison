import { getServiceClient } from './_lib/wardenAuth.js'

// /api/booking-guest — POST(免登入):不註冊預約。
// 訪客只留遊戲暱稱進預約名單(user_id = null),不建任何帳號、無法登入系統。
// 寫入走 service_role(RLS 不開放 anon insert);場次存在/容量/密鑰皆在伺服器端驗。
// 防重複:同場次、同暱稱(不分大小寫)、未取消的訪客預約視為已報名。
const WEBHOOK = process.env.DISCORD_BOOKING_WEBHOOK_URL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const supabase = getServiceClient()
    if (!supabase) return res.status(500).json({ error: 'server_not_configured' })

    const { session_id, game_name, password } = req.body || {}
    if (!session_id) return res.status(400).json({ error: 'missing_session_id' })
    const gn = typeof game_name === 'string' ? game_name.trim().slice(0, 60) : ''
    if (gn.length < 1) return res.status(400).json({ error: 'missing_game_name' })

    // 場次存在 + 未額滿(public_sessions 為 SECURITY DEFINER 計數,booked 含訪客列)
    const { data: pub } = await supabase.rpc('public_sessions')
    const sess = (pub || []).find(s => s.id === session_id)
    if (!sess) return res.status(404).json({ error: 'session_not_found' })
    if (sess.capacity != null && sess.booked >= sess.capacity) return res.status(409).json({ error: 'full' })

    // 密鑰場:伺服器端核對通行密鑰
    if (sess.has_password) {
      const pw = typeof password === 'string' ? password.trim() : ''
      const { data: pwOk } = await supabase.rpc('check_session_password', { p_session: session_id, p_password: pw })
      if (!pwOk) return res.status(403).json({ error: 'wrong_password' })
    }

    // 防重複(訪客沒有身分,以同場+同暱稱兜底;有帳號的列不在此列)
    const { data: dup } = await supabase.from('bookings')
      .select('id').eq('session_id', session_id).is('user_id', null)
      .ilike('game_name', gn).neq('status', 'cancelled').limit(1)
    if (dup && dup.length) return res.status(409).json({ error: 'already_booked' })

    const { error: insErr } = await supabase.from('bookings').insert({
      session_id, user_id: null, dc_id: null, dc_name: null,
      game_name: gn, avatar_url: null, note: null,
    })
    if (insErr) return res.status(500).json({ error: 'insert_failed', detail: insErr.message })

    // Discord 通知(失敗不擋預約)
    if (WEBHOOK) {
      const n = (sess.booked ?? 0) + 1
      const cap = sess.capacity != null ? `/${sess.capacity}` : ''
      const date = sess.session_date ? `（${sess.session_date}）` : ''
      try {
        await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `🔒 新收監（訪客）｜${gn} 報名了【${sess.title}】${date}目前 ${n}${cap}` }),
        })
      } catch { /* 通知失敗不影響預約 */ }
    }

    return res.status(200).json({ ok: true, booked: (sess.booked ?? 0) + 1, capacity: sess.capacity })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
