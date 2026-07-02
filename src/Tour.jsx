import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'

// 後台系統教學導覽:指向式氣泡(coach-mark)。
// 每步驟依 anchor 指向某個元素(分頁鈕 'tab:<k>' 或頁面區塊 'region:<id>')並高亮它,
// 氣泡帶箭頭指過去;找不到 anchor 時退回置中卡片。外層負責切分頁與示範假資料。
// step: { tab, kind?, anchor?, place?:'auto'|'up'|'down'|'left'|'right', title, body }

const GAP = 14        // 目標與氣泡的間距
const MARGIN = 12     // 氣泡距視窗邊緣的最小留白
const ARROW = 9       // 箭頭尺寸
const FALLBACK = { w: 360, h: 220 }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// 選側:回傳能容納氣泡且空間最大的一側;都放不下回傳 null(置中)
function pickSide(vis, bw, bh, vw, vh, isTab, place) {
  const space = {
    up: vis.top, down: vh - vis.bottom, left: vis.left, right: vw - vis.right,
  }
  const fits = (s) => (s === 'up' || s === 'down') ? space[s] >= bh + GAP + MARGIN : space[s] >= bw + GAP + MARGIN
  if (place && place !== 'auto' && fits(place)) return place
  const order = isTab ? ['down', 'up', 'right', 'left'] : ['right', 'down', 'up', 'left']
  const ok = order.filter(fits)
  if (!ok.length) return null
  return ok.reduce((best, s) => (space[s] > space[best] ? s : best), ok[0])
}

// anchor → DOM 選擇器值:'tab:<k>' 原樣(分頁鈕帶 data-tour="tab:<k>");'region:<id>' 去前綴(區塊帶 data-tour="<id>")
const anchorSelector = (anchor) => anchor.startsWith('region:') ? anchor.slice(7) : anchor

// 幾何相等比較:捲動/DOM 變動高頻觸發重算時,結果沒變就不 setState(避免無謂重繪)
const ringEq = (a, b) => (!a && !b) || (a && b && a.top === b.top && a.left === b.left && a.w === b.w && a.h === b.h)
const geoEq = (a, b) => a && b && a.side === b.side && a.arrow === b.arrow
  && a.bubble.top === b.bubble.top && a.bubble.left === b.bubble.left && ringEq(a.ring, b.ring)

export default function Tour({ steps, label, onClose, onNavigate, onStepChange }) {
  const [i, setI] = useState(0)
  const bubbleRef = useRef(null)
  const scrolledRef = useRef(-1)         // 已為此步驟捲動過(每步只自動捲一次,晚掛載的錨點由 recompute 補捲)
  const rafRef = useRef(0)               // 合流用:同一影格內多次觸發只重算一次
  const [geo, setGeo] = useState(null)   // { side|null, bubble:{top,left}, arrow:number, ring:{top,left,w,h}|null }
  const step = steps && steps.length ? steps[i] : null
  const last = step && i === steps.length - 1

  // 每到一步:通知外層(切分頁 + 設定示範 kind)
  useEffect(() => {
    if (!step) return
    onStepChange?.(step)
    onNavigate?.(step.tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  const recompute = useCallback(() => {
    if (!step) return
    const anchor = step.anchor || null
    const target = anchor ? document.querySelector(`[data-tour="${anchorSelector(anchor)}"]`) : null
    const b = bubbleRef.current
    const bw = b?.offsetWidth || FALLBACK.w
    const bh = b?.offsetHeight || FALLBACK.h
    const vw = window.innerWidth, vh = window.innerHeight
    // 結果沒變就不 setState(高頻觸發時避免整棵重繪)
    const commit = (next) => setGeo(prev => (geoEq(prev, next) ? prev : next))
    if (!target) {
      commit({ side: null, bubble: { top: (vh - bh) / 2, left: (vw - bw) / 2 }, arrow: 0, ring: null })
      return
    }
    // 找到目標且此步驟尚未自動捲動 → 先捲入視窗再量測(涵蓋切分頁/切 kind 後才掛載的區塊)
    if (scrolledRef.current !== i) {
      scrolledRef.current = i
      const r0 = target.getBoundingClientRect()
      const off = r0.top < 0 || r0.bottom > vh || r0.left < 0 || r0.right > vw
      if (off) target.scrollIntoView({ block: 'center', inline: 'center' })
      else if (anchor.startsWith('tab:')) target.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
    const r = target.getBoundingClientRect()
    const ring = { top: r.top - 3, left: r.left - 3, w: r.width + 6, h: r.height + 6 }
    // 目標可見範圍(高於視窗的高區塊,只用可見部分定位氣泡)
    const vis = {
      top: Math.max(r.top, MARGIN), bottom: Math.min(r.bottom, vh - MARGIN),
      left: Math.max(r.left, MARGIN), right: Math.min(r.right, vw - MARGIN),
    }
    const isTab = anchor.startsWith('tab:')
    const side = pickSide(vis, bw, bh, vw, vh, isTab, step.place)
    if (!side) {
      commit({ side: null, bubble: { top: (vh - bh) / 2, left: (vw - bw) / 2 }, arrow: 0, ring })
      return
    }
    const cx = (vis.left + vis.right) / 2, cy = (vis.top + vis.bottom) / 2
    let top, left, arrow
    if (side === 'down' || side === 'up') {
      top = side === 'down' ? vis.bottom + GAP : vis.top - GAP - bh
      left = clamp(cx - bw / 2, MARGIN, vw - MARGIN - bw)
      arrow = clamp(cx - left, ARROW + 10, bw - ARROW - 10)
    } else {
      left = side === 'right' ? vis.right + GAP : vis.left - GAP - bw
      top = clamp(cy - bh / 2, MARGIN, vh - MARGIN - bh)
      arrow = clamp(cy - top, ARROW + 10, bh - ARROW - 10)
    }
    commit({ side, bubble: { top, left }, arrow, ring })
  }, [step, i])

  // 合流:捲動/縮放/DOM 變動高頻觸發時,同一影格只重算一次
  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; recompute() })
  }, [recompute])

  // 步驟切換:同步定位一次(recompute 內含首次自動捲動),再排一次 rAF 補量(等示範頁掛載/字體排版)
  useLayoutEffect(() => {
    if (!step) return
    recompute()
    schedule()
  }, [i, recompute, schedule, step])

  // 捲動/縮放/區塊掛載時重新定位(皆走 rAF 合流)
  useEffect(() => {
    if (!step) return
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const page = document.querySelector('.page')
    const mo = page ? new MutationObserver(schedule) : null
    if (mo && page) mo.observe(page, { childList: true, subtree: true })
    const ro = bubbleRef.current ? new ResizeObserver(schedule) : null
    if (ro && bubbleRef.current) ro.observe(bubbleRef.current)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      mo?.disconnect(); ro?.disconnect()
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 }
    }
  }, [step, schedule])

  if (!step) return null

  const arrowStyle = geo?.side === 'up' || geo?.side === 'down'
    ? { left: geo.arrow } : { top: geo?.arrow }

  return (
    <>
      {/* 有目標:外框陰影挖洞,只暗周圍、高亮元素保持原亮度;無目標(置中):整面淡遮罩 */}
      {geo?.ring
        ? <div className="cm-ring" style={{ top: geo.ring.top, left: geo.ring.left, width: geo.ring.w, height: geo.ring.h }} />
        : <div className="cm-scrim" />}
      <div ref={bubbleRef} className={`cm-bubble${geo?.side ? ` place-${geo.side}` : ' centered'}`}
        style={geo ? { top: geo.bubble.top, left: geo.bubble.left } : { visibility: 'hidden' }}
        role="dialog" aria-modal="true">
        {geo?.side && <span className={`cm-arrow ${geo.side}`} style={arrowStyle} />}
        {/* 內容捲動層:限制高度讓按鈕永遠在畫面內;overflow 不放氣泡本體以免剪掉外緣箭頭 */}
        <div className="cm-scroll">
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
    </>
  )
}
