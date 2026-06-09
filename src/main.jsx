import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import BroadcastScreen from './BroadcastScreen.jsx'
import PrisonSite from './site/PrisonSite.jsx'

// 直播模式沿用既有 ?broadcast=<sessionId>,在進路由前短路掉(保留現有直播連結)
const broadcastId = new URLSearchParams(window.location.search).get('broadcast')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {broadcastId ? (
      <BroadcastScreen sessionId={broadcastId} />
    ) : (
      <BrowserRouter>
        <Routes>
          {/* 公開形象官網(單頁式,免登入;入監服刑走頁內 modal) */}
          <Route path="/" element={<PrisonSite />} />
          {/* 監所系統(登入後依角色顯示:典獄長主控台 / 獄卒作業 / 本次服刑) */}
          <Route path="/app" element={<App />} />
          <Route path="/warden" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )}
  </StrictMode>,
)

// 通知載入動畫:React 已首次繪製。實際淡出時機(含最短 3 秒)由 splash.js 掌管。
function signalAppPainted() {
  if (typeof window.__dpAppPainted === 'function') window.__dpAppPainted()
  else requestAnimationFrame(signalAppPainted) // splash.js 尚未就緒就再等一幀
}
requestAnimationFrame(() => requestAnimationFrame(signalAppPainted))
