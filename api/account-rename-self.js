import { getServiceClient, ACCOUNT_DOMAIN, ACCOUNT_RE } from './_lib/wardenAuth.js'

// /api/account-rename-self — POST(本人):修改自己的登入帳號名。
// 一般 supabase.auth.updateUser({ email }) 會走確認信流程,假 email 收不到信,
// 所以由這支以 service key 代改(對象固定為 JWT 驗出的本人,不收 user_id)。
// 僅限 account_type === 'warden_created' 的帳號;改名不影響任何關聯資料(皆掛 uuid)。
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const supabase = getServiceClient()
    if (!supabase) return res.status(500).json({ error: 'server_not_configured' })

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: 'not_authenticated' })
    const { data: { user }, error: uErr } = await supabase.auth.getUser(token)
    if (uErr || !user) return res.status(401).json({ error: 'not_authenticated' })
    if (user.user_metadata?.account_type !== 'warden_created') {
      return res.status(400).json({ error: 'not_warden_created' })
    }

    const account = typeof req.body?.account === 'string' ? req.body.account.trim().toLowerCase() : ''
    if (!ACCOUNT_RE.test(account)) return res.status(400).json({ error: 'invalid_account' })

    const email = `${account}@${ACCOUNT_DOMAIN}`
    if (user.email === email) return res.status(200).json({ ok: true, account })   // 沒變,視為成功

    const { error: upErr } = await supabase.auth.admin.updateUserById(user.id, {
      email,
      email_confirm: true,
    })
    if (upErr) {
      if (upErr.status === 422 || /already.*(registered|exists)|duplicate/i.test(upErr.message || '')) {
        return res.status(409).json({ error: 'account_exists' })
      }
      return res.status(500).json({ error: 'update_failed', detail: upErr.message })
    }

    return res.status(200).json({ ok: true, account })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
