import { useEffect } from 'react'

// 操作訊息橫條:語意配色(成功綠/失敗紅,非主題黑紅)、可手動關閉、數秒後自動消失。
// 嚴重度用訊息文字推斷(含「失敗/錯誤/還原/必填/請」視為紅,其餘綠)。
export default function MessageBanner({ msg, onClose, duration = 5000 }) {
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(onClose, duration)
    return () => clearTimeout(t)
  }, [msg]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!msg) return null
  const isError = /失敗|錯誤|還原|必填|請/.test(msg)
  return (
    <div className={`banner ${isError ? 'err' : 'ok'}`}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} aria-label="關閉">×</button>
    </div>
  )
}
