import { supabase } from '../supabaseClient'
import { normalizeStatus, materializeResultMsg } from './constants'

// 典獄長場次鏈式動作:對外移除「開始入場(intake)」流程後,
// 「開始服刑」一鈕完成 帶入預約名單 + 進 serving;「退回預約中」一鈕完成 清番茄鐘 + 清名單。
// DB 的 set_session_status 轉移規則不動:鏈內只用既有合法轉移
// (booking/booking_paused→intake、intake→serving、serving→intake、intake→booking),
// intake 只是鏈中的瞬時狀態(UI 標籤「準備服刑」,僅中斷殘留時可見)。

// 開始服刑:①(必要時)→intake ②materialize 帶入預約名單(失敗不中斷,回 warning)③→serving。
// 回傳 { error?, warning?, msg }:
//   error   → 呼叫端回滾樂觀更新(步驟①失敗 DB 未動;步驟③失敗停在 intake,再按一次可續跑)
//   warning → 已開始服刑但帶名單有問題(可用「重新帶入預約名單」補救)
//   msg     → 成功訊息(含 materialize 逐筆跳過提示)
export async function startServingChain(session) {
  const st = normalizeStatus(session)
  if (st === 'booking' || st === 'booking_paused') {
    const r1 = await supabase.rpc('set_session_status', { p_session: session.id, p_new_status: 'intake' })
    if (r1.error) return { error: '開始失敗：' + r1.error.message }
  }
  // intake 起點(鏈中斷殘留/舊資料)直接續跑;materialize 冪等,重複呼叫可補帶新預約
  const mat = await supabase.rpc('materialize_session_bookings', { p_session: session.id })
  const warning = mat.error ? '帶入預約名單失敗：' + mat.error.message + '，可稍後按「重新帶入預約名單」' : null
  const r2 = await supabase.rpc('set_session_status', { p_session: session.id, p_new_status: 'serving' })
  if (r2.error) return { error: '開始服刑未完成（場次停在準備狀態），請再按一次「開始服刑」：' + r2.error.message }
  const skipMsg = mat.error ? null : materializeResultMsg(mat.data)
  const msg = skipMsg && skipMsg !== '已帶入預約名單' ? skipMsg : '已開始服刑'
  return { warning, msg: warning ? `已開始服刑（${warning}）` : msg }
}

// 退回預約中:serving→intake(後端清番茄鐘)→intake→booking(觸發器清 inmate 名單,goals 隨 cascade)。
// 起點已是 intake(殘留)則只做第二步。回傳 { error?, msg }。
export async function revertToBookingChain(session) {
  const st = normalizeStatus(session)
  if (st === 'serving') {
    const r1 = await supabase.rpc('set_session_status', { p_session: session.id, p_new_status: 'intake' })
    if (r1.error) return { error: '退回失敗：' + r1.error.message }
  }
  const r2 = await supabase.rpc('set_session_status', { p_session: session.id, p_new_status: 'booking' })
  if (r2.error) return { error: '退回未完成（場次停在準備狀態），請再按一次「退回預約中」：' + r2.error.message }
  return { msg: '已退回預約中（番茄鐘與本場名單已清除，預約資料保留）' }
}

// 退回確認文案(SessionsOverviewTab / SessionTimerControl 共用;作為 askConfirm 彈窗內文,標題=「退回預約中」)
export const REVERT_CONFIRM = '將清除番茄鐘計時與本場名單。預約資料保留，之後開始服刑會重新帶入。'
