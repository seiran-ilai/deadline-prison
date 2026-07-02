import { requireWarden } from './_lib/wardenAuth.js'
import { guardWebhookFor } from './_lib/salaryWebhooks.js'

// /api/salary-broadcast — POST(僅典獄長):把前端算好的薪資明細純文字轉發到 Discord。
// 不帶 guard_name → 送「伊萊諾斯和監獄的收支」頻道(env DISCORD_SALARY_WEBHOOK_URL);
// 帶 guard_name → 送該獄卒的個人薪資頻道(_lib/salaryWebhooks 對照;可用 DISCORD_GUARD_WEBHOOKS_JSON 覆蓋)。
// 身分由 requireWarden 驗證(profiles.role === 'warden');內容為 warden 端計算好的字串,伺服器只負責轉發。
const WEBHOOK = process.env.DISCORD_SALARY_WEBHOOK_URL

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  try {
    const auth = await requireWarden(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    const guardName = typeof req.body?.guard_name === 'string' ? req.body.guard_name.trim() : ''
    const target = guardName ? guardWebhookFor(guardName) : WEBHOOK
    if (guardName && !target) return res.status(404).json({ error: 'guard_webhook_not_found' })
    if (!target) return res.status(500).json({ error: 'webhook_not_configured' })

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (!content) return res.status(400).json({ error: 'missing_content' })
    if (content.length > 1800) return res.status(400).json({ error: 'content_too_long' })   // Discord 單則上限 2000

    const r = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!r.ok) return res.status(502).json({ error: 'discord_failed', detail: `status ${r.status}` })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(500).json({ error: 'server_error', detail: String(e?.message || e) })
  }
}
