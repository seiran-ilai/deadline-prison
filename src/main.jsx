import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import BroadcastScreen from './BroadcastScreen.jsx'
import PublicLayout from './public/PublicLayout.jsx'
import Home from './public/Home.jsx'
import About from './public/About.jsx'
import Staff from './public/Staff.jsx'
import SessionsPublic from './public/SessionsPublic.jsx'
import Serve from './Serve.jsx'

// 直播模式沿用既有 ?broadcast=<sessionId>,在進路由前短路掉(保留現有直播連結)
const broadcastId = new URLSearchParams(window.location.search).get('broadcast')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {broadcastId ? (
      <BroadcastScreen sessionId={broadcastId} />
    ) : (
      <BrowserRouter>
        <Routes>
          {/* 公開形象官網(免登入) */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/sessions" element={<SessionsPublic />} />
            <Route path="/serve" element={<Serve />} />
          </Route>
          {/* 監所系統(登入後依角色顯示:典獄長主控台 / 獄卒作業 / 本次服刑) */}
          <Route path="/app" element={<App />} />
          <Route path="/warden" element={<App />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )}
  </StrictMode>,
)
