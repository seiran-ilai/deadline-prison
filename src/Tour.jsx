import { useState } from 'react'

// 後台系統教學導覽:置中步驟卡(不綁特定元素,穩定不跑版)。
// 可「跳過」隨時結束,或「下一步 / 上一步」逐步看完。onClose 於跳過或完成時呼叫。
// props: steps = [{ title, body }];label 顯示於卡頂(如「獄卒導覽」)。
export default function Tour({ steps, label, onClose }) {
  const [i, setI] = useState(0)
  if (!steps || !steps.length) return null
  const step = steps[i]
  const last = i === steps.length - 1
  return (
    <div className="tour-bg" role="dialog" aria-modal="true">
      <div className="tour-card">
        <div className="tour-head">
          {label && <span className="tour-label">{label}</span>}
          <span className="tour-count">{i + 1} / {steps.length}</span>
          <button className="tour-x" aria-label="跳過導覽" onClick={onClose}>✕</button>
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-dots">
          {steps.map((_, n) => <i key={n} className={n === i ? 'on' : ''} />)}
        </div>
        <div className="tour-acts">
          <button className="tour-skip" onClick={onClose}>跳過</button>
          <span className="spacer" />
          {i > 0 && <button className="btn-ghost" onClick={() => setI(i - 1)}>上一步</button>}
          <button className="btn-pri" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? '完成' : '下一步'}</button>
        </div>
      </div>
    </div>
  )
}
