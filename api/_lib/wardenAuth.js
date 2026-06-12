import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'

// /api/admin-* 三支共用:warden 驗證、service client、帳號名/密碼工具。
// 底線開頭目錄不會被 Vercel 建成 function,僅供 import。
// 環境變數(Vercel 後台設定,勿進 repo、勿加 VITE_ 前綴讓它進前端 bundle):
//   SUPABASE_URL(可沿用 VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY(service_role 金鑰,僅伺服器端)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// 代開帳號的假 email 後綴:使用者只看到/只輸入帳號名,後綴由程式補
export const ACCOUNT_DOMAIN = 'inmate.deadline-prison.local'
export const ACCOUNT_RE = /^[a-z0-9_]{3,20}$/

// 驗證呼叫者身分:Authorization JWT → getUser → profiles.role === 'warden'。
// 通過回 { supabase: service client, caller };失敗回 { status, error }(呼叫端原樣回給前端)。
export async function requireWarden(req) {
  if (!SUPABASE_URL || !SERVICE_KEY) return { status: 500, error: 'server_not_configured' }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return { status: 401, error: 'not_authenticated' }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { status: 401, error: 'not_authenticated' }
  const { data: prof, error: pErr } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (pErr) return { status: 500, error: 'server_error' }
  if (prof?.role !== 'warden') return { status: 403, error: 'forbidden' }
  return { supabase, caller: user }
}

// 12 碼隨機密碼:英數混合,排除易混淆字元 0O1lI(randomInt 為 CSPRNG,無模數偏差)
const PW_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function genPassword() {
  for (;;) {
    let pw = ''
    for (let i = 0; i < 12; i++) pw += PW_CHARS[randomInt(PW_CHARS.length)]
    if (/[a-zA-Z]/.test(pw) && /[2-9]/.test(pw)) return pw   // 保證真的英數「混合」
  }
}
