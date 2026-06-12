// 站方帳號政策:信箱註冊與 Discord 登入/註冊已整個移除(非開關隱藏)。
// 唯一登入通道為「信箱或帳號 + 密碼」;新帳號由典獄長後台「收監登記」開立後轉交。

// 官網導覽列「ACCESS · 監獄系統」入口:false = 隱藏(/app 路由仍在,只是不從官網曝光)。
export const SHOW_APP_ACCESS = false

// 典獄長代開帳號的假 email 後綴(與 api/_lib/wardenAuth.js 的 ACCOUNT_DOMAIN 同值):
// 使用者只輸入帳號名,登入時不含 @ 即自動補此後綴;此字串不得出現在任何畫面上。
export const INTERNAL_ACCOUNT_DOMAIN = 'inmate.deadline-prison.local'
