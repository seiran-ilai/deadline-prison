import { NavLink, Outlet } from 'react-router-dom'

// 形象官網共用外框:頂部導覽 + 內容區(Outlet)。免登入可瀏覽。
const NAV = [
  { to: '/', label: '首頁', end: true },
  { to: '/about', label: '監獄介紹' },
  { to: '/staff', label: '監獄人員' },
  { to: '/sessions', label: '近期場次' },
]

export default function PublicLayout() {
  const linkStyle = ({ isActive }) => ({
    padding: '6px 12px', borderRadius: 4, textDecoration: 'none',
    color: isActive ? '#fff' : '#ccc', background: isActive ? '#444' : 'transparent',
  })
  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#eee', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderBottom: '1px solid #333', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 18, marginRight: 12 }}>🔒 死線監獄</strong>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} style={linkStyle}>{n.label}</NavLink>)}
        </nav>
        <span style={{ flex: 1 }} />
        <a href="/app" style={{ padding: '6px 12px', borderRadius: 4, textDecoration: 'none', color: '#1a1a1a', background: '#e0b04a' }}>監所系統登入</a>
      </header>
      <main style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
        <Outlet />
      </main>
    </div>
  )
}
