import { requireWarden, genPassword, ACCOUNT_DOMAIN, ACCOUNT_RE } from './_lib/wardenAuth.js'

// /api/admin-create-account — POST(僅 warden):代開帳號。
// 流程:warden 驗證 → 檢查輸入 → admin.createUser(假 email + 隨機密碼,標記首登改密)
//       → admin_create_profile RPC 建檔發號(與 claim_profile 同一條 inmate_no_seq 路徑)。
// 回傳 { ok, account, password } — 預設密碼僅此一次,不落任何 log。
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = await requireWarden(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase } = auth

    const account = typeof req.body?.account === 'string' ? req.body.account.trim().toLowerCase() : ''
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : ''
    if (!ACCOUNT_RE.test(account)) return res.status(400).json({ error: 'invalid_account' })
    if (displayName.length < 2 || displayName.length > 20) return res.status(400).json({ error: 'invalid_display_name' })

    const email = `${account}@${ACCOUNT_DOMAIN}`
    const password = genPassword()
    const { data: created, error: cErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,   // 假 email 收不到驗證信,直接視為已驗證
      user_metadata: { display_name: displayName, must_change_password: true, account_type: 'warden_created' },
    })
    if (cErr) {
      // 帳號名已存在:GoTrue 回 email 已註冊(422)
      if (cErr.status === 422 || /already.*(registered|exists)/i.test(cErr.message || '')) {
        return res.status(409).json({ error: 'account_exists' })
      }
      return res.status(500).json({ error: 'create_failed', detail: cErr.message })
    }

    // 建檔發號(service_role 專用 RPC);失敗則回滾剛建立的 auth 帳號,不留半套
    const { error: pErr } = await supabase.rpc('admin_create_profile', {
      p_user_id: created.user.id,
      p_display_name: displayName,
    })
    if (pErr) {
      await supabase.auth.admin.deleteUser(created.user.id)
      return res.status(500).json({ error: 'profile_failed', detail: pErr.message })
    }

    return res.status(200).json({ ok: true, account, password })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
