// 信箱註冊開關(/app 登入頁與官網入監 modal 共用):false = 隱藏註冊入口、擋下註冊送出。
// 要重新開放信箱註冊,把這裡改回 true 即可。
// 注意:這只關前端入口;若要徹底關閉(連直接打 Supabase API 也擋),
// 需到 Supabase Dashboard → Authentication → Providers → Email 關閉 signups。
export const EMAIL_SIGNUP_OPEN = false

// Discord 登入開關:false = /app 登入頁與官網入監 modal 都隱藏 Discord 登入按鈕。
export const DISCORD_LOGIN_OPEN = false

// 官網導覽列「ACCESS · 監獄系統」入口:false = 隱藏(/app 路由仍在,只是不從官網曝光)。
export const SHOW_APP_ACCESS = false
