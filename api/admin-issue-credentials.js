import { requireWarden, ACCOUNT_DOMAIN, ACCOUNT_RE } from './_lib/wardenAuth.js'

// /api/admin-issue-credentials — POST(僅 warden):為「既有用戶」核發登入帳密。
// 信箱與 Discord 登入已全面移除,這支讓舊用戶(Discord 或信箱註冊皆可)改用
// 「帳號名+密碼」登入:在原本的 auth 使用者上設定假 email 與典獄長自訂的密碼
// (uuid 不變,profiles/紀錄完全不動),並標 account_type='warden_created'。
// 可重複核發:已核發過的帳號再核發一次,新帳號名+新密碼直接蓋過舊的
// (本人忘記密碼即走此路)。不設 must_change_password:帳密由典獄長親自轉交,
// 本人登入後可在個人資料頁自行修改帳號名與密碼。
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = await requireWarden(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { supabase } = auth

    const userId = typeof req.body?.user_id === 'string' ? req.body.user_id.trim() : ''
    const account = typeof req.body?.account === 'string' ? req.body.account.trim().toLowerCase() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!userId) return res.status(400).json({ error: 'missing_user_id' })
    if (!ACCOUNT_RE.test(account)) return res.status(400).json({ error: 'invalid_account' })
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'invalid_password' })

    const { data: got, error: gErr } = await supabase.auth.admin.getUserById(userId)
    if (gErr || !got?.user) return res.status(404).json({ error: 'user_not_found' })

    const email = `${account}@${ACCOUNT_DOMAIN}`
    const { error: uErr } = await supabase.auth.admin.updateUserById(userId, {
      email,
      password,
      email_confirm: true,
      // admin 更新會整包覆蓋 user_metadata,先展開既有值(保留 Discord 名稱等)再加旗標
      user_metadata: { ...got.user.user_metadata, must_change_password: false, account_type: 'warden_created' },
    })
    if (uErr) {
      if (uErr.status === 422 || /already.*(registered|exists)|duplicate/i.test(uErr.message || '')) {
        return res.status(409).json({ error: 'account_exists' })
      }
      return res.status(500).json({ error: 'update_failed', detail: uErr.message })
    }

    // 同步 profiles.account_type,讓後台名單切換為「重設密碼/改帳號名」操作。
    // 失敗不回滾 auth(帳密已可用),回 warning 讓前端提示重整即可。
    const { error: pErr } = await supabase.from('profiles')
      .update({ account_type: 'warden_created' }).eq('id', userId)

    return res.status(200).json({ ok: true, account, password, profile_warning: pErr ? pErr.message : null })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
