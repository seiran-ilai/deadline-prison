// 場次類型(僅標籤,不改變預約/入場流程):
//   crunch 集體趕稿 / named 指名互動 / free 自由入場
// 單一真相在此;warden 後台、形象官網、Discord 通知都用這份對照。
// DB 端 sessions.kind 為 text，default 'crunch'，check in (這三個 code)。
export const SESSION_KINDS = ['crunch', 'named', 'free']

export const SESSION_KIND_LABEL = {
  crunch: '集體趕稿',
  named: '指名互動',
  free: '自由入場',
}

export const DEFAULT_SESSION_KIND = 'crunch'

// 防呆:未知/缺值 → 視為集體趕稿(既有場次的預設語意)
export function sessionKindLabel(kind) {
  return SESSION_KIND_LABEL[kind] ?? SESSION_KIND_LABEL[DEFAULT_SESSION_KIND]
}
