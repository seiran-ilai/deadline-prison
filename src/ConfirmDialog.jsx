import { useState, useEffect } from 'react'
import './styles/confirm.css'

// 全站共用確認彈窗:取代原生 window.confirm(原生視窗標題會顯示「Code」、樣式與站內不一致)。
// 標題 = 目前流程名稱(結束服刑/退回預約中/刪除場次…),主按鈕用動作動詞,破壞性操作紅色強調。
// 用法:const ok = await askConfirm({ title, message, confirmLabel, danger });<ConfirmHost /> 掛在頁面根(後台 App 與官網各一)。
// Esc / 點背景 / ✕ = 取消。

let hostListener = null

export function askConfirm({ title = '請確認', message = '', confirmLabel = '確定', danger = false } = {}) {
  // 防呆:host 未掛載(理論上不會)退回原生 confirm,至少不擋操作
  if (!hostListener) return Promise.resolve(window.confirm(message || title))
  return new Promise(resolve => hostListener({ title, message, confirmLabel, danger, resolve }))
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)
  useEffect(() => {
    hostListener = setReq
    return () => { if (hostListener === setReq) hostListener = null }
  }, [])
  useEffect(() => {
    if (!req) return
    const onKey = (e) => { if (e.key === 'Escape') { req.resolve(false); setReq(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])
  if (!req) return null
  const done = (ok) => { req.resolve(ok); setReq(null) }
  return (
    <div className="cfm-bg" onClick={() => done(false)}>
      <div className="cfm-modal" role="alertdialog" aria-modal="true" aria-labelledby="cfm-title" onClick={e => e.stopPropagation()}>
        <div className="cfm-head">
          <span className={`cfm-ico${req.danger ? ' danger' : ''}`} aria-hidden="true">{req.danger ? '⚠' : '？'}</span>
          <h3 id="cfm-title">{req.title}</h3>
          <button type="button" className="cfm-x" aria-label="關閉" onClick={() => done(false)}>✕</button>
        </div>
        <p className="cfm-msg">{req.message}</p>
        <div className="cfm-acts">
          <button type="button" className="cfm-btn" onClick={() => done(false)}>取消</button>
          <button type="button" className={`cfm-btn pri${req.danger ? ' danger' : ''}`} autoFocus onClick={() => done(true)}>
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
