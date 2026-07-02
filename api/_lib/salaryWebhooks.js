// 各獄卒「個人薪資頻道」webhook 對照(僅伺服器端使用,不進前端 bundle)。
// webhook 屬機密,不寫死在 repo:一律由環境變數 DISCORD_GUARD_WEBHOOKS_JSON 提供,
// 格式為 JSON 物件 {"獄卒名":"https://discord.com/api/webhooks/…", …},
// 鍵 = 獄卒顯示名(profiles.game_name / display_name,結算卡上的名字)。
// 本機開發放 .env.local、正式站放 Vercel 環境變數(勿加 VITE_ 前綴)。
export function guardWebhookFor(name) {
  const key = String(name ?? '').trim()
  if (!key) return null
  try {
    const map = JSON.parse(process.env.DISCORD_GUARD_WEBHOOKS_JSON || '{}')
    const url = map[key]
    return typeof url === 'string' && url.startsWith('https://') ? url : null
  } catch {
    return null   // env JSON 格式錯誤:視為未設定(API 端回 guard_webhook_not_found)
  }
}
