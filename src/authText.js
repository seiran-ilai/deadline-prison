// Supabase auth 錯誤訊息中文化(/app 登入頁與官網入監 modal 共用)
export function zhAuthError(message) {
  const m = message ?? ''
  if (m.includes('Invalid login credentials')) return '信箱或密碼錯誤'
  if (m.includes('Email not confirmed')) return '請先完成信箱驗證'
  if (m.includes('User already registered')) return '此信箱已註冊過，請直接登入'
  if (m.includes('Password should be at least')) return '密碼至少需 8 碼'
  if (m.includes('valid email') || m.includes('invalid format')) return '信箱格式不正確'
  if (m.includes('Email rate limit') || m.includes('rate limit')) return '寄信次數已達上限，請稍後再試'
  if (m.includes('same') && m.includes('password')) return '新密碼不可與舊密碼相同'
  if (m.includes('different from the old')) return '新密碼不可與舊密碼相同'
  if (m.includes('session missing') || m.includes('expired')) return '重設連結已失效，請重新申請密碼重設'
  return '操作失敗，請稍後再試'
}
