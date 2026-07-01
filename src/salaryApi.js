import { supabase } from './supabaseClient'

// 薪資明細發送前端封裝:帶目前登入者 access token,身分由 /api/salary-broadcast 伺服器端驗證(warden)。
// 回傳 { ok, status, ...伺服器 JSON }
export async function sendSalaryBroadcast(content) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { ok: false, status: 401, error: 'not_authenticated' }
  const res = await fetch('/api/salary-broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, ...json }
}

// 發送薪資 API 錯誤碼中文化
export function zhSalaryError(code) {
  const map = {
    not_authenticated: '登入狀態已失效，請重新登入',
    forbidden: '僅典獄長可執行此操作',
    webhook_not_configured: '尚未設定薪資頻道 webhook（請在伺服器環境變數設定 DISCORD_SALARY_WEBHOOK_URL）',
    missing_content: '沒有可發送的內容',
    content_too_long: '內容過長（Discord 單則上限 2000 字）',
    discord_failed: '發送到 Discord 失敗，請稍後再試',
  }
  return map[code] ?? '發送失敗，請稍後再試'
}
