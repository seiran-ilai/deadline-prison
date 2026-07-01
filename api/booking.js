import { createClient } from '@supabase/supabase-js'

// /api/booking — POST：驗證登入(以伺服器端 token 為準)→ 寫 bookings → 送 Discord 通知。
// 身分不信任前端自報;一律用 Authorization 帶來的 JWT 經 getUser 驗證。
// 環境變數(Vercel 後台設定,勿進 repo):
//   SUPABASE_URL / SUPABASE_ANON_KEY（或沿用 VITE_ 前綴的同名變數）
//   DISCORD_BOOKING_WEBHOOK_URL
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const WEBHOOK = process.env.DISCORD_BOOKING_WEBHOOK_URL

// 場次類型標籤(對照 src/sessionKind.js;serverless 不能 import src,故在此複製一份)
const KIND_LABEL = { crunch: '集體趕稿', named: '指名互動', free: '自由入場' }
const kindLabel = k => KIND_LABEL[k] || KIND_LABEL.crunch

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'not_authenticated' })
    const { session_id, note, game_name, avatar_url, password, requested_slots, addons, capture } = req.body || {}
    if (!session_id) return res.status(400).json({ error: 'missing_session_id' })

    // 以使用者 JWT 建立 client → insert 走 RLS(user_id = auth.uid())
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: uErr } = await supabase.auth.getUser(token)
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' })

    const meta = user.user_metadata || {}
    const dc_id = meta.provider_id || meta.sub || user.id
    const dc_name = meta.full_name || meta.name || meta.global_name
      || meta.custom_claims?.global_name || meta.user_name || '(unknown)'

    // 場次存在 + 未額滿(用 SECURITY DEFINER 計數,避免 RLS 看不到別人預約)
    const { data: pub } = await supabase.rpc('public_sessions')
    const sess = (pub || []).find(s => s.id === session_id)
    if (!sess) return res.status(404).json({ error: 'session_not_found' })
    if (sess.capacity != null && sess.booked >= sess.capacity) return res.status(409).json({ error: 'full' })

    // 密鑰場:伺服器端核對通行密鑰(不只靠前端擋;密鑰內容只在 DB 與典獄長後台)
    if (sess.has_password) {
      const pw = typeof password === 'string' ? password.trim() : ''
      const { data: pwOk } = await supabase.rpc('check_session_password', { p_session: session_id, p_password: pw })
      if (!pwOk) return res.status(403).json({ error: 'wrong_password' })
    }

    // 指名/監督:逐筆核對 (guard, slot) 在本場可指名清單且尚未被搶(named 依 g+s、crunch 依 g;s=null)。
    // 陣列無 DB 唯一索引兜底,一律伺服器端驗;picks 寫入 requested_slots jsonb。
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
    // 每卒加購 / 抓捕訂單:sanitize(僅指名/集體場採計)
    const cleanAddons = nameable && Array.isArray(addons)
      ? addons.filter(a => a && a.g)
          .map(a => ({ g: a.g, polaroid: Math.max(0, Math.min(99, parseInt(a.polaroid) || 0)), sign: !!a.sign, portrait: Math.max(0, Math.min(99, parseInt(a.portrait) || 0)) }))
          .filter(a => a.polaroid > 0 || a.portrait > 0)
      : []
    const cleanCapture = (sess.kind === 'crunch' && capture && typeof capture === 'object')
      ? { client: String(capture.client || '').slice(0, 60), target: String(capture.target || '').slice(0, 60), server: String(capture.server || '').slice(0, 60), guards: Math.max(2, Math.min(99, parseInt(capture.guards) || 2)) }
      : null

    // insert(DB 唯一鍵兜底重複)
    // game_name / avatar_url:前端帶來的展示值(暱稱/頭像),僅供該筆預約顯示,不作身分依據;
    // 身分一律以上方 JWT 驗證的 user.id / dc_* 為準。長度做基本上限,避免過長字串。
    let gn = typeof game_name === 'string' ? game_name.trim().slice(0, 60) : null
    let av = typeof avatar_url === 'string' ? avatar_url.trim().slice(0, 500) : null
    // 後端兜底:前端沒帶到暱稱/頭像時,從本人 profile 補上(本人讀本人列走 RLS)。
    // 確保每筆預約都留有頭像/暱稱快照,不依賴前端是否成功預填(修正部分預約沒帶到頭像的問題)。
    if (!gn || !av) {
      const { data: prof } = await supabase.from('profiles')
        .select('game_name, avatar_url').eq('id', user.id).maybeSingle()
      if (!gn) gn = prof?.game_name?.trim().slice(0, 60) || null
      if (!av) av = prof?.avatar_url?.trim().slice(0, 500) || null
    }
    const { error: insErr } = await supabase.from('bookings').insert({
      session_id, user_id: user.id, dc_id, dc_name, note: note || null,
      game_name: gn || null, avatar_url: av || null,
      requested_slots: picks, addons: cleanAddons, capture: cleanCapture,
    })
    if (insErr) {
      if (insErr.code === '23505') return res.status(409).json({ error: 'already_booked' })   // 本人本場重複預約
      return res.status(500).json({ error: 'insert_failed', detail: insErr.message })
    }

    // 送 Discord 通知(URL 取自 env;失敗不擋預約)
    if (WEBHOOK) {
      const n = (sess.booked ?? 0) + 1
      const cap = sess.capacity != null ? `/${sess.capacity}` : ''
      const date = sess.session_date ? `（${sess.session_date}）` : ''
      const kind = `〔${kindLabel(sess.kind)}〕`
      const req = nameable
        ? (picks.length ? `｜指名/監督：${picks.length} 筆` : '｜不指定（由典獄長安排）')
        : ''
      const capNote = cleanCapture ? `｜抓捕：委託 ${cleanCapture.client || '?'} → ${cleanCapture.target || '?'}（${cleanCapture.server || '?'}）` : ''
      try {
        await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `🔒 新收監｜${dc_name} 報名了${kind}【${sess.title}】${date}目前 ${n}${cap}${req}${capNote}` }),
        })
      } catch { /* 通知失敗不影響預約 */ }
    }

    return res.status(200).json({ ok: true, booked: (sess.booked ?? 0) + 1, capacity: sess.capacity })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
