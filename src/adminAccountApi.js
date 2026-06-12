import { supabase } from './supabaseClient'

// 典獄長代開帳號三支 API 的前端封裝:帶目前登入者 access token,
// 身分由伺服器端驗證(profiles.role === 'warden'),前端只負責轉交。
// 回傳 { ok, status, ...伺服器 JSON }
async function call(path, payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, status: 401, error: 'not_authenticated' }
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ...json }
}

export const adminCreateAccount = (account, displayName) =>
  call('/api/admin-create-account', { account, display_name: displayName })

export const adminResetPassword = (userId) =>
  call('/api/admin-reset-password', { user_id: userId })

export const adminRenameAccount = (userId, account) =>
  call('/api/admin-rename-account', { user_id: userId, account })

// API 錯誤碼中文化(收監登記/重設密碼/改帳號名共用)
export function zhAdminError(code) {
  const map = {
    invalid_account: '帳號名格式不符：僅允許小寫英文、數字與底線，3–20 字',
    invalid_display_name: '獄中名號需為 2–20 字',
    account_exists: '此帳號名已被使用，請換一個',
    not_warden_created: '此類帳號不可使用此操作（僅限典獄長代開的帳號）',
    user_not_found: '找不到該使用者',
    forbidden: '僅典獄長可執行此操作',
    not_authenticated: '登入狀態已失效，請重新登入',
    server_not_configured: '伺服器尚未設定完成（缺 service key），請聯繫管理員',
  }
  return map[code] ?? '操作失敗，請稍後再試'
}
