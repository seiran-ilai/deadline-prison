import { requireWarden } from './_lib/wardenAuth.js'
import { createAnonInmate } from './_lib/autoInmate.js'

// /api/walkin — POST(僅典獄長):臨時報名建立走查犯人。
// 自動建檔發號(暱稱 + 伺服器,account_type=walkin;同暱稱+伺服器沿用既有犯人),
// 並建一筆走查 booking(user_id 綁該犯人、arrived=true)。回 { ok, booking_id, inmate_no }。
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = await requireWarden(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase } = auth

    const session_id = req.body?.session_id
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : ''
    const server = typeof req.body?.server === 'string' ? req.body.server.trim().slice(0, 60) : ''
    if (!session_id) return res.status(400).json({ error: 'missing_session_id' })
    if (!name) return res.status(400).json({ error: 'missing_name' })

    // 自動建檔發號(同暱稱+伺服器沿用既有犯人)
    const anon = await createAnonInmate(supabase, name, server, 'walkin')
    if (anon.error) return res.status(500).json({ error: 'inmate_failed', detail: anon.error })

    // 防重複:同場 + 同暱稱 + 同伺服器(未取消)已有走查列則沿用,不重建
    const { data: dup } = await supabase.from('bookings')
      .select('id, server').eq('session_id', session_id).ilike('game_name', name).neq('status', 'cancelled')
    const existing = (dup || []).find(d => (d.server || '').trim().toLowerCase() === server.toLowerCase())
    if (existing) return res.status(200).json({ ok: true, booking_id: existing.id, inmate_no: anon.inmateNo })

    const { data: bk, error: insErr } = await supabase.from('bookings').insert({
      session_id, user_id: anon.userId, dc_id: null, dc_name: null,
      game_name: name, server: server || null, status: 'confirmed', arrived: true,
    }).select('id').single()
    if (insErr) return res.status(500).json({ error: 'insert_failed', detail: insErr.message })

    return res.status(200).json({ ok: true, booking_id: bk.id, inmate_no: anon.inmateNo })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
