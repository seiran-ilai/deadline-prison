import { requireWarden, genPassword } from './_lib/wardenAuth.js'

// /api/admin-reset-password — POST(僅 warden):重設代開帳號的密碼。
// 產新隨機密碼 + 重新標記 must_change_password,使用者下次登入會再被強制改密。
// 僅對 account_type === 'warden_created' 的帳號開放(一般 email / Discord 帳號不可由典獄長重設)。
// 回傳 { ok, account, password } — 新密碼僅此一次,不落任何 log。
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = await requireWarden(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase } = auth

    const userId = typeof req.body?.user_id === 'string' ? req.body.user_id.trim() : ''
    if (!userId) return res.status(400).json({ error: 'missing_user_id' })

    const { data: got, error: gErr } = await supabase.auth.admin.getUserById(userId)
    if (gErr || !got?.user) return res.status(404).json({ error: 'user_not_found' })
    if (got.user.user_metadata?.account_type !== 'warden_created') {
      return res.status(400).json({ error: 'not_warden_created' })
    }

    const password = genPassword()
    const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
      password,
      // admin 更新會整包覆蓋 user_metadata,須先展開既有值再改旗標
      user_metadata: { ...got.user.user_metadata, must_change_password: true },
    })
    if (uErr) return res.status(500).json({ error: 'update_failed', detail: uErr.message })

    const account = (got.user.email || '').split('@')[0]
    return res.status(200).json({ ok: true, account, password })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
