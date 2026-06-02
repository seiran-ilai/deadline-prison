import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('me')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) { setProfile(null); setLoading(false); return }
    setLoading(true)
    supabase
      .from('profiles')
      .select('inmate_no, display_name, role')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { setProfile(data); setLoading(false) })
  }, [user])

  async function signIn() {
    await supabase.auth.signInWithOAuth({ provider: 'discord' })
  }
  async function signOut() {
    await supabase.auth.signOut()
  }

  const box = { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', gap: 16 }

  // 未登入
  if (!user) {
    return (
      <div style={box}>
        <h1>死線監獄 · Doing Time</h1>
        <button onClick={signIn}>用 Discord 登入</button>
      </div>
    )
  }

  // 載入中
  if (loading) {
    return <div style={box}><p>載入中…</p></div>
  }

  // 已登入但沒編號 = 候補狀態
  if (!profile || profile.inmate_no == null) {
    return (
      <div style={box}>
        <h1>死線監獄</h1>
        <p>無犯人資料,請與典獄長確認</p>
        <a href="https://discord.gg/你的邀請連結" target="_blank" rel="noreferrer">聯繫典獄長(Discord)</a>
        <button onClick={signOut}>登出</button>
      </div>
    )
  }

  // 已收押 = 顯示骨架
  const isStaff = profile.role === 'guard' || profile.role === 'warden'
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <strong>死線監獄 · No.{String(profile.inmate_no).padStart(4, '0')} {profile.display_name}</strong>
        <button onClick={signOut}>登出</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('me')}>我的牢房</button>
        <button onClick={() => setTab('timer')}>服刑計時</button>
        {isStaff && <button onClick={() => setTab('warden')}>典獄長主控台</button>}
      </div>

      <div style={{ padding: 40, border: '1px dashed #999', borderRadius: 8, textAlign: 'center' }}>
        {tab === 'me' && <p>📍 這裡是個人頁(犯人證 + 任務)</p>}
        {tab === 'timer' && <p>📍 這裡是服刑計時頁(番茄鐘)</p>}
        {tab === 'warden' && <p>📍 這裡是典獄長主控台(收押 + 名單)</p>}
      </div>
    </div>
  )
}

export default App