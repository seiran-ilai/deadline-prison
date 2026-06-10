// 網頁載入動畫:只在「官網」(路徑 '/')顯示;監獄系統(/app、/warden 等)完全不載入。
// 規則(官網時):動畫至少完整顯示 3 秒(自 Lottie 真正就緒起算),且要等 App 首次繪製後才淡出。
// 動畫檔放在 public/loader.json(獨立 fetch,不進主 bundle);lottie-web 以動態 import 載入,
// 因此非官網頁面不會抓 loader.json、也不會下載 lottie-web。

const root = document.getElementById('dp-splash')
let active = false       // 只有官網啟用淡出邏輯
let appPainted = false   // main.jsx 在 React 首次繪製後透過 window.__dpAppPainted 設定
let minElapsed = false   // Lottie 就緒後再過 3 秒設定

function hideNow() {
  if (!root) return
  root.classList.add('dp-hide')
  root.addEventListener('transitionend', () => root.remove(), { once: true })
  setTimeout(() => root.remove(), 800) // 後備:transitionend 沒觸發時也移除
}
function tryHide() {
  if (active && appPainted && minElapsed) hideNow()
}

// 一定先定義(splash.js 在 main.jsx 之前執行),確保 main.jsx 必呼叫得到;
// 只記錄狀態,實際淡出由 tryHide 依條件判斷。非官網頁面這裡等同 no-op。
window.__dpAppPainted = () => { appPainted = true; tryHide() }

if (window.location.pathname === '/') {
  active = true
  // 官網才動態載入 lottie-web 並播放動畫
  import('lottie-web').then(({ default: lottie }) => {
    const container = document.getElementById('dp-splash-anim')
    if (!container) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const anim = lottie.loadAnimation({
      container, renderer: 'svg', loop: false, autoplay: false, path: '/loader.json',
    })
    // loader.json 原生 90 幀(30fps):格子逐格亮起,第 84 幀全滿、第 85 幀整排清空(循環復位用)。
    // 因此只播 0→84 段,停在「全滿」幀不再動;並校速讓全滿剛好落在第 3 秒(與最少顯示 3 秒對齊)。
    const FULL_FRAME = 84
    const startMinTimer = () => setTimeout(() => { minElapsed = true; tryHide() }, 3000)
    anim.addEventListener('DOMLoaded', () => {           // 動畫資料載入且首幀就緒
      if (reduce) {
        anim.goToAndStop(FULL_FRAME, true)               // 減動效:直接停在 100% 全滿幀
      } else {
        const fr = anim.frameRate || 30
        anim.setSpeed((FULL_FRAME / fr) / 3)             // 84 幀 ÷ 30fps = 2.8s → 放慢到 3s 整
        anim.playSegments([0, FULL_FRAME], true)
      }
      startMinTimer()
    })
    anim.addEventListener('data_failed', startMinTimer) // 抓不到檔也別把畫面卡死
  })
} else {
  // 監獄系統等頁面:立刻移除佔位,不載入動畫
  root?.remove()
}
