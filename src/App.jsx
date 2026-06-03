import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import ManuscriptManager from './ManuscriptManager'
import SessionGoals from './SessionGoals'
import SessionTimer from './SessionTimer'
import WardenPanel from './warden/WardenPanel'

function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('session')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) { setProfile(null); setLoading(false); return }
    async function init() {
      setLoading(true)
      await supabase.rpc('claim_profile')
      const { data: p } = await supabase.from('profiles')
        .select('inmate_no, display_name, game_name, role').eq('id', user.id).single()
      setProfile(p)
      setLoading(false)
    }
    init()
  }, [user])

  async function signIn() { await supabase.auth.signInWithOAuth({ provider: 'discord' }) }
  async function signOut() { await supabase.auth.signOut() }

  const box = { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', gap: 16 }

  if (!user) return <div style={box}><h1>死線監獄 · Doing Time</h1><button onClick={signIn}>用 Discord 登入</button></div>
  if (loading) return <div style={box}><p>核對身分中…</p></div>
  if (!profile || profile.inmate_no == null) {
    return (
      <div style={box}>
        <h1>死線監獄</h1>
        <p>查無預約資料,請與典獄長確認</p>
        <a href="https://discord.gg/你的邀請連結" target="_blank" rel="noreferrer">聯繫典獄長(Discord)</a>
        <button onClick={signOut}>登出</button>
      </div>
    )
  }

  const isStaff = profile.role === 'guard' || profile.role === 'warden'
  const tabBtnStyle = (k) => ({
    padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
    fontWeight: tab === k ? 700 : 400,
    background: tab === k ? '#eef4ff' : '#fafafa',
    border: tab === k ? '1px solid #5a8fd0' : '1px solid #bbb',
    color: '#333',
  })
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <strong>死線監獄 · No.{String(profile.inmate_no).padStart(4, '0')} {profile.game_name ?? profile.display_name}</strong>
        <button onClick={signOut}>登出</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('session')} style={tabBtnStyle('session')}>本場服刑</button>
        <button onClick={() => setTab('timer')} style={tabBtnStyle('timer')}>服刑計時</button>
        <button onClick={() => setTab('me')} style={tabBtnStyle('me')}>我的稿件</button>
        {isStaff && <button onClick={() => setTab('warden')} style={tabBtnStyle('warden')}>典獄長主控台</button>}
      </div>
      {tab === 'session' && <SessionGoals userId={user.id} />}
      {tab === 'timer' && <SessionTimer userId={user.id} />}
      {tab === 'me' && (
        <div>
          <p style={{ color: '#666', marginTop: 0 }}>📍 我的稿件 · 遊戲暱稱:{profile.game_name ?? '(未設定)'}</p>
          <h3>稿件管理</h3>
          <ManuscriptManager userId={user.id} />
        </div>
      )}
      {tab === 'warden' && isStaff && <WardenPanel myRole={profile.role} />}
    </div>
  )
}

export default App
