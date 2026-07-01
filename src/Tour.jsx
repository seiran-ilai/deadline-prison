import { useState, useEffect } from 'react'

// 導覽用模擬畫面:講解「目前不在場而看不到」的頁面(犯人服刑番茄鐘 / 獄卒本場工作)時,
// 用小型示意圖說明,不需真的在場。
function TourMock({ kind }) {
  if (kind === 'pomodoro') {
    return (
      <div className="tour-mock">
        <div className="tm-timer">
          <div className="tm-phase"><span className="tm-badge">服刑中</span><span className="tm-round">第 1 / 4 輪</span></div>
          <div className="tm-clock">24:12</div>
          <div className="tm-dots"><i className="cur" /><i /><i /><i /></div>
        </div>
        <div className="tm-cap">集體趕稿場:專注 25 分 → 放風 5 分為一輪;指名/自由場則顯示本場狀態。</div>
      </div>
    )
  }
  if (kind === 'guardwork') {
    return (
      <div className="tour-mock">
        <div className="tm-work">
          <div className="tm-wrow"><span className="tm-type">拍立得</span><span className="tm-who">客A</span><b className="tm-amt">5 萬</b></div>
          <div className="tm-wrow"><span className="tm-type sup">指定監督</span><span className="tm-who">客B</span><b className="tm-amt">30 萬</b></div>
          <div className="tm-income">
            <span>個人薪資 27 萬 ＋ 獎金 2.5 萬</span><b>總金額 29.5 萬</b>
          </div>
        </div>
        <div className="tm-cap">指派給你的服務項目與即時收入(示意)。實際在場服刑時會顯示本場真實資料。</div>
      </div>
    )
  }
  return null
}

// 後台系統教學導覽:對話框步驟卡,依步驟自動切換分頁講解;看不到的畫面改用模擬圖。
// props: steps = [{ tab?, mock?, title, body }];label 卡頂標籤;onNavigate(tab) 由外層切分頁。
export default function Tour({ steps, label, onClose, onNavigate }) {
  const [i, setI] = useState(0)
  const step = steps && steps.length ? steps[i] : null
  // 每到一步就切到該步驟對應的分頁(逐步切換頁面);有模擬圖的步驟仍可切到該分頁(後方顯示未解鎖提示,前方以模擬圖講解)
  useEffect(() => { if (step?.tab) onNavigate?.(step.tab) }, [i, step?.tab])
  if (!step) return null
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
        {step.mock && <TourMock kind={step.mock} />}
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
