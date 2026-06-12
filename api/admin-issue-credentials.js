import { requireWarden, genPassword, ACCOUNT_DOMAIN, ACCOUNT_RE } from './_lib/wardenAuth.js'

// /api/admin-issue-credentials — POST(僅 warden):為「既有 Discord 註冊用戶」核發帳號密碼。
// Discord 登入入口已移除,這支讓舊用戶改用「帳號名+密碼」登入:
//   在原本的 auth 使用者上補假 email + 隨機密碼(uuid 不變,profiles/紀錄完全不動),
//   標記 must_change_password 走首登強制改密,並把帳號標成 warden_created
//   (此後可用既有的重設密碼/改帳號名操作)。
// 安全條件:對象必須沒有真實 email(identify scope 的 Discord 用戶 email 為空)。
//   有真實 email 的一般註冊用戶若被覆蓋 email 會直接斷登入,故拒絕。
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
    if (got.user.user_metadata?.account_type === 'warden_created') {
      return res.status(400).json({ error: 'already_issued' })
    }
    if (got.user.email) return res.status(400).json({ error: 'has_real_email' })

    const email = `${account}@${ACCOUNT_DOMAIN}`
    const password = genPassword()
    const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
      email,
      password,
      email_confirm: true,
      // admin 更新會整包覆蓋 user_metadata,先展開既有值(保留 Discord 名稱等)再加旗標
      user_metadata: { ...got.user.user_metadata, must_change_password: true, account_type: 'warden_created' },
    })
    if (uErr) {
      if (uErr.status === 422 || /already.*(registered|exists)|duplicate/i.test(uErr.message || '')) {
        return res.status(409).json({ error: 'account_exists' })
      }
      return res.status(500).json({ error: 'update_failed', detail: uErr.message })
    }

    // 同步 profiles.account_type,讓後台名單顯示「重設密碼/改帳號名」操作。
    // 失敗不回滾 auth(帳密已可用),回 warning 讓前端提示重整即可。
    const { error: pErr } = await supabase.from('profiles')
      .update({ account_type: 'warden_created' }).eq('id', userId)

    return res.status(200).json({ ok: true, account, password, profile_warning: pErr ? pErr.message : null })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
