import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [claimResult, setClaimResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('me')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) { setProfile(null); setLoading(false); return }
    async function init() {
      setLoading(true)
      // 先嘗試認領(配對預約名單)
      const { data: result } = await supabase.rpc('claim_profile')
      setClaimResult(result)
      // 再讀自己的 profile
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

  if (!user) {
    return <div style={box}><h1>死線監獄 · Doing Time</h1><button onClick={signIn}>用 Discord 登入</button></div>
  }
  if (loading) return <div style={box}><p>核對身分中…</p></div>

  // 配不到預約資料(unmatched 且沒有 profile)
  if (!profile) {
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
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <strong>死線監獄 · No.{String(profile.inmate_no).padStart(4, '0')} {profile.game_name ?? profile.display_name}</strong>
        <button onClick={signOut}>登出</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('me')}>我的牢房</button>
        <button onClick={() => setTab('timer')}>服刑計時</button>
        {isStaff && <button onClick={() => setTab('warden')}>典獄長主控台</button>}
      </div>
      {tab === 'me' && <div style={{ padding: 40, border: '1px dashed #999', borderRadius: 8, textAlign: 'center' }}><p>📍 個人頁 · 遊戲暱稱:{profile.game_name ?? '(未設定)'}</p></div>}
      {tab === 'timer' && <div style={{ padding: 40, border: '1px dashed #999', borderRadius: 8, textAlign: 'center' }}><p>📍 服刑計時頁</p></div>}
      {tab === 'warden' && isStaff && <WardenPanel />}
    </div>
  )
}

function WardenPanel() {
  const [pending, setPending] = useState([])
  const [inmates, setInmates] = useState([])
  const [form, setForm] = useState({ game_name: '', discord_account: '', avatar_url: '' })
  const [msg, setMsg] = useState('')

  async function load() {
    const { data: pend } = await supabase.from('pending_inmates').select('*').order('created_at')
    const { data: inm } = await supabase.from('profiles').select('id, inmate_no, game_name, display_name').not('inmate_no', 'is', null).order('inmate_no')
    setPending(pend ?? [])
    setInmates(inm ?? [])
  }
  useEffect(() => { load() }, [])

  async function addPending() {
    if (!form.game_name || !form.discord_account) { setMsg('遊戲暱稱和 Discord 帳號必填'); return }
    const { error } = await supabase.from('pending_inmates').insert({
      game_name: form.game_name,
      discord_account: form.discord_account,
      avatar_url: form.avatar_url || null
    })
    if (error) { setMsg('新增失敗:' + error.message); return }
    setMsg('已加入預約名單')
    setForm({ game_name: '', discord_account: '', avatar_url: '' })
    load()
  }

  return (
    <div>
      <h3>新增預約犯人</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input placeholder="遊戲暱稱" value={form.game_name} onChange={e => setForm({ ...form, game_name: e.target.value })} />
        <input placeholder="Discord 使用者名稱" value={form.discord_account} onChange={e => setForm({ ...form, discord_account: e.target.value })} />
        <input placeholder="頭貼網址(選填)" value={form.avatar_url} onChange={e => setForm({ ...form, avatar_url: e.target.value })} />
        <button onClick={addPending}>加入預約</button>
      </div>
      {msg && <p style={{ color: '#2a7' }}>{msg}</p>}

      <h3 style={{ marginTop: 24 }}>預約名單(待登入認領)</h3>
      {pending.length === 0 ? <p style={{ color: '#888' }}>目前沒有預約</p> : (
        <ul>{pending.map(p => <li key={p.id}>{p.game_name}（{p.discord_account}）</li>)}</ul>
      )}

      <h3 style={{ marginTop: 24 }}>在押名單</h3>
      {inmates.length === 0 ? <p style={{ color: '#888' }}>還沒有人在押</p> : (
        <ul>{inmates.map(p => <li key={p.id}>No.{String(p.inmate_no).padStart(4, '0')} · {p.game_name ?? p.display_name}</li>)}</ul>
      )}
    </div>
  )
}

export default App