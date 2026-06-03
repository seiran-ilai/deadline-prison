import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import BroadcastScreen from './BroadcastScreen.jsx'

// 用網址參數 ?broadcast=<sessionId> 切換成「直播模式」(不裝路由)
const broadcastId = new URLSearchParams(window.location.search).get('broadcast')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {broadcastId ? <BroadcastScreen sessionId={broadcastId} /> : <App />}
  </StrictMode>,
)
