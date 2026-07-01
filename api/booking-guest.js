import { getServiceClient } from './_lib/wardenAuth.js'
import { sendReservationBroadcast } from './_lib/reservationBroadcast.js'

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

    const { session_id, game_name, password, requested_slots, addons, capture } = req.body || {}
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

    // 指名/監督:逐筆核對 (guard, slot) 在本場可指名清單且尚未被搶(named 依 g+s、crunch 依 g;s=null)
    const nameable = sess.kind === 'named' || sess.kind === 'crunch'
    const picks = []
    if (nameable && Array.isArray(requested_slots) && requested_slots.length) {
      const { data: ns } = await supabase.rpc('session_named_slots', { p_session: session_id })
      const seen = new Set()
      for (const p of requested_slots) {
        const g = p?.g; const s = (p?.s ?? null)
        if (!g) continue
        const key = `${g}|${s ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        const hit = (ns || []).find(r => r.guard_id === g && (r.slot_index ?? null) === s)
        if (!hit || hit.portrait_only) return res.status(403).json({ error: 'guard_not_nameable' })   // 肖像畫獄卒不接指名/監督
        if (hit.taken) return res.status(409).json({ error: 'slot_taken' })
        picks.push({ g, s })
      }
    }
    const cleanAddons = nameable && Array.isArray(addons)
      ? addons.filter(a => a && a.g)
          .map(a => ({ g: a.g, polaroid: Math.max(0, Math.min(99, parseInt(a.polaroid) || 0)), sign: !!a.sign, portrait: Math.max(0, Math.min(99, parseInt(a.portrait) || 0)) }))
          .filter(a => a.polaroid > 0 || a.portrait > 0)
      : []
    // 抓捕訂單:伺服器欄位已移除(預約人暱稱已含伺服器);不再寫入 capture.server。
    const cleanCapture = (sess.kind === 'crunch' && capture && typeof capture === 'object')
      ? { client: String(capture.client || '').slice(0, 60), target: String(capture.target || '').slice(0, 60), guards: Math.max(2, Math.min(99, parseInt(capture.guards) || 2)) }
      : null

    // 防重複(訪客沒有身分,以同場+同暱稱兜底;有帳號的列不在此列)
    const { data: dup } = await supabase.from('bookings')
      .select('id').eq('session_id', session_id).is('user_id', null)
      .ilike('game_name', gn).neq('status', 'cancelled').limit(1)
    if (dup && dup.length) return res.status(409).json({ error: 'already_booked' })

    const { error: insErr } = await supabase.from('bookings').insert({
      session_id, user_id: null, dc_id: null, dc_name: null,
      game_name: gn, avatar_url: null, note: null,
      requested_slots: picks, addons: cleanAddons, capture: cleanCapture,
    })
    if (insErr) return res.status(500).json({ error: 'insert_failed', detail: insErr.message })

    // Discord 通知(組固定格式播報字串;訪客名稱即 gn=暱稱@伺服器;失敗不擋預約)
    await sendReservationBroadcast(supabase, {
      webhook: WEBHOOK, sess, picks, addons: cleanAddons,
      captureTarget: cleanCapture?.target || null,
      isMember: false, name: gn, inmateNo: null,
      count: (sess.booked ?? 0) + 1, action: '新報名',
    })

    return res.status(200).json({ ok: true, booked: (sess.booked ?? 0) + 1, capacity: sess.capacity })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
