import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn() {
    await supabase.auth.signInWithOAuth({ provider: 'discord' })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <h1>死線監獄 · Doing Time</h1>
      {user ? (
        <>
          <p>已收押:{user.email ?? user.id}</p>
          <button onClick={signOut}>登出</button>
        </>
      ) : (
        <button onClick={signIn}>用 Discord 登入</button>
      )}
    </div>
  )
}

export default App