import { getServiceClient } from './_lib/wardenAuth.js'
import { sendReservationBroadcast } from './_lib/reservationBroadcast.js'
import { createAnonInmate } from './_lib/autoInmate.js'

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

    const { session_id, game_name, server, password, requested_slots, addons, capture } = req.body || {}
    if (!session_id) return res.status(400).json({ error: 'missing_session_id' })
    const gn = typeof game_name === 'string' ? game_name.trim().slice(0, 60) : ''
    const sv = typeof server === 'string' ? server.trim().slice(0, 60) : ''
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
    // 抓捕訂單:被抓捕者(target)帶暱稱 + 伺服器,結帳時自動建檔發號(account_type=capture)。
    let cleanCapture = (sess.kind === 'crunch' && capture && typeof capture === 'object')
      ? { client: String(capture.client || '').slice(0, 60), target: String(capture.target || '').slice(0, 60), targetServer: String(capture.targetServer || '').slice(0, 60), guards: Math.max(2, Math.min(99, parseInt(capture.guards) || 2)) }
      : null
    if (cleanCapture?.target) {
      const tgt = await createAnonInmate(supabase, cleanCapture.target, cleanCapture.targetServer, 'capture')
      if (tgt.inmateNo != null) cleanCapture = { ...cleanCapture, target_no: tgt.inmateNo }
    }

    // 防重複(同場 + 同暱稱 + 同伺服器,未取消)
    let dupQ = supabase.from('bookings').select('id, server')
      .eq('session_id', session_id).ilike('game_name', gn).neq('status', 'cancelled')
    const { data: dupRows } = await dupQ
    if ((dupRows || []).some(d => (d.server || '').trim().toLowerCase() === sv.toLowerCase())) {
      return res.status(409).json({ error: 'already_booked' })
    }

    // 匿名訪客自動建檔發號:同「暱稱+伺服器」沿用既有犯人,否則建號。失敗不擋預約(退回無帳號走查列)。
    const anon = await createAnonInmate(supabase, gn, sv, 'guest')
    const guestUserId = anon.userId || null

    const { error: insErr } = await supabase.from('bookings').insert({
      session_id, user_id: guestUserId, dc_id: null, dc_name: null,
      game_name: gn, server: sv || null, avatar_url: null, note: null,
      requested_slots: picks, addons: cleanAddons, capture: cleanCapture,
    })
    if (insErr) return res.status(500).json({ error: 'insert_failed', detail: insErr.message })

    // Discord 通知(組固定格式播報字串;訪客名稱即 gn=暱稱@伺服器;失敗不擋預約)
    await sendReservationBroadcast(supabase, {
      webhook: WEBHOOK, sess, picks, addons: cleanAddons,
      captureTarget: cleanCapture ? (cleanCapture.targetServer ? `${cleanCapture.target}@${cleanCapture.targetServer}` : cleanCapture.target) : null,
      isMember: false, name: sv ? `${gn}@${sv}` : gn, inmateNo: null,
      count: (sess.booked ?? 0) + 1, action: '新報名',
    })

    return res.status(200).json({
      ok: true, booked: (sess.booked ?? 0) + 1, capacity: sess.capacity,
      inmate_no: anon.inmateNo ?? null,
      // 首次(新建帳號)才回傳明文帳密供犯人留存;沿用既有帳號則不回傳
      account: anon.reused ? null : (anon.account ?? null),
      password: anon.reused ? null : (anon.password ?? null),
    })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
