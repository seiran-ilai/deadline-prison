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
  const palette = isError
    ? { bg: '#fdecea', color: '#b3261e', border: '#f3c0bd' }
    : { bg: '#e7f6ec', color: '#1b5e20', border: '#b6e0c2' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px',
      padding: '8px 12px', borderRadius: 6,
      background: palette.bg, color: palette.color, border: `1px solid ${palette.border}`,
    }}>
      <span style={{ flex: 1 }}>{msg}</span>
      <button onClick={onClose} aria-label="關閉"
        style={{ border: 'none', background: 'none', color: palette.color, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
    </div>
  )
}
