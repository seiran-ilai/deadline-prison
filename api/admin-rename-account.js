import { requireWarden, ACCOUNT_DOMAIN, ACCOUNT_RE } from './_lib/wardenAuth.js'

// /api/admin-rename-account — POST(僅 warden):修改代開帳號的帳號名。
// 實際上是改 auth email 的 local part(後綴固定),關聯資料皆掛 uuid 不受影響。
// 僅對 account_type === 'warden_created' 的帳號開放;一般 email 註冊帳號回 400。
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = await requireWarden(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase } = auth

    const userId = typeof req.body?.user_id === 'string' ? req.body.user_id.trim() : ''
    const account = typeof req.body?.account === 'string' ? req.body.account.trim().toLowerCase() : ''
    if (!userId) return res.status(400).json({ error: 'missing_user_id' })
    if (!ACCOUNT_RE.test(account)) return res.status(400).json({ error: 'invalid_account' })

    const { data: got, error: gErr } = await supabase.auth.admin.getUserById(userId)
    if (gErr || !got?.user) return res.status(404).json({ error: 'user_not_found' })
    if (got.user.user_metadata?.account_type !== 'warden_created') {
      return res.status(400).json({ error: 'not_warden_created' })
    }

    const email = `${account}@${ACCOUNT_DOMAIN}`
    if (got.user.email === email) return res.status(200).json({ ok: true, account })   // 沒變,視為成功

    const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,   // 假 email 不走確認信,直接生效
    })
    if (uErr) {
      // 新帳號名撞到既有 email
      if (uErr.status === 422 || /already.*(registered|exists)|duplicate/i.test(uErr.message || '')) {
        return res.status(409).json({ error: 'account_exists' })
      }
      return res.status(500).json({ error: 'update_failed', detail: uErr.message })
    }

    return res.status(200).json({ ok: true, account })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
