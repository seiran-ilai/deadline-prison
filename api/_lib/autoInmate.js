import { randomUUID } from 'node:crypto'
import { genPassword, ACCOUNT_DOMAIN } from './wardenAuth.js'

// 匿名犯人自動建檔發號:建一個「不可實際登入」的假帳號(隨機 email + 隨機密碼,永不外流),
// 再以 create_auto_inmate RPC 建 profiles、發流水編號、記錄伺服器。回傳 { userId, inmateNo, name, server }。
// supabase 必須是 service_role client(auth.admin 需要);失敗回 { error }。
// accountType:'walkin'(臨時入場)/ 'guest'(只填名字)/ 'capture'(被抓捕)。
export async function createAnonInmate(supabase, name, server = '', accountType = 'walkin') {
  const gn = typeof name === 'string' ? name.trim().slice(0, 60) : ''
  const sv = typeof server === 'string' ? server.trim().slice(0, 60) : ''
  if (!gn) return { error: 'missing_name' }

  // 對號入座:同「暱稱 + 伺服器」已有犯人 → 直接沿用該份資料(累積歷史,不重複建號)。
  // 以暱稱撈候選(通常極少),伺服器在 JS 比對(含空伺服器);不分大小寫。
  const { data: cands } = await supabase.from('profiles')
    .select('id, inmate_no, game_name, server').ilike('game_name', gn)
  const svLc = sv.toLowerCase()
  const hit = (cands || []).find(p =>
    (p.game_name || '').trim().toLowerCase() === gn.toLowerCase() &&
    (p.server || '').trim().toLowerCase() === svLc)
  if (hit) return { userId: hit.id, inmateNo: hit.inmate_no, name: gn, server: sv, reused: true }

  const email = `auto-${randomUUID()}@${ACCOUNT_DOMAIN}`
  const { data: created, error: cErr } = await supabase.auth.admin.createUser({
    email,
    password: genPassword(),
    email_confirm: true,   // 假 email 直接視為已驗證;此帳號不對外、無人持有密碼
    user_metadata: { game_name: gn, server: sv || null, account_type: accountType, auto_inmate: true },
  })
  if (cErr || !created?.user) return { error: cErr?.message || 'create_user_failed' }
  const { data: inmateNo, error: pErr } = await supabase.rpc('create_auto_inmate', {
    p_user_id: created.user.id, p_game_name: gn, p_server: sv || null, p_account_type: accountType,
  })
  if (pErr) {
    await supabase.auth.admin.deleteUser(created.user.id)   // 回滾,不留半套
    return { error: pErr.message }
  }
  return { userId: created.user.id, inmateNo, name: gn, server: sv }
}
