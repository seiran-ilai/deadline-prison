import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
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
  const [unmatched, setUnmatched] = useState([])
  const [inmates, setInmates] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState('')
  const [roster, setRoster] = useState([])
  const [form, setForm] = useState({ game_name: '', discord_account: '', avatar_url: '' })
  const [sessionTitle, setSessionTitle] = useState('')
  const [pickInmate, setPickInmate] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    const { data: pend } = await supabase.from('pending_inmates').select('*').order('created_at')
    const { data: all } = await supabase.from('profiles').select('id, inmate_no, game_name, display_name, discord_account, role')
    const { data: sess } = await supabase.from('sessions').select('*').eq('status', 'open').order('created_at', { ascending: false })
    setPending(pend ?? [])
    setUnmatched((all ?? []).filter(p => p.inmate_no == null))
    setInmates((all ?? []).filter(p => p.inmate_no != null))
    setSessions(sess ?? [])
    if (sess && sess.length && !currentSession) setCurrentSession(sess[0].id)
  }
  useEffect(() => { load() }, [])

  async function loadRoster(sid) {
    if (!sid) { setRoster([]); return }
    const { data } = await supabase.from('session_inmates')
      .select('id, state, member_id, profiles(inmate_no, game_name, display_name)')
      .eq('session_id', sid)
    setRoster(data ?? [])
  }
  useEffect(() => { loadRoster(currentSession) }, [currentSession])

  async function addPending() {
    if (!form.game_name || !form.discord_account) { setMsg('遊戲暱稱和 Discord 帳號必填'); return }
    const { error } = await supabase.from('pending_inmates').insert({
      game_name: form.game_name, discord_account: form.discord_account, avatar_url: form.avatar_url || null })
    if (error) { setMsg('新增失敗:' + error.message); return }
    setMsg('已加入預約名單'); setForm({ game_name: '', discord_account: '', avatar_url: '' }); load()
  }

  async function openSession() {
    if (!sessionTitle) { setMsg('請填場次名'); return }
    const { data, error } = await supabase.from('sessions').insert({ title: sessionTitle }).select().single()
    if (error) { setMsg('開場失敗:' + error.message); return }
    setMsg('已開場:' + sessionTitle); setSessionTitle(''); setCurrentSession(data.id); load()
  }

  async function checkIn() {
    if (!currentSession || !pickInmate) { setMsg('請選場次和犯人'); return }
    const { error } = await supabase.rpc('check_in_inmate', { p_session: currentSession, p_member: pickInmate })
    if (error) { setMsg('報到失敗:' + error.message); return }
    setMsg('已報到'); setPickInmate(''); loadRoster(currentSession)
  }

  async function admitDirect(userId) {
    const name = prompt('請輸入遊戲暱稱:'); if (!name) return
    const { error } = await supabase.rpc('admit_unmatched', { target_id: userId, p_game_name: name })
    if (error) { setMsg('收押失敗:' + error.message); return }
    setMsg('已收押'); load()
  }
  async function linkToPending(userId) {
    if (pending.length === 0) { setMsg('沒有預約資料可指定'); return }
    const list = pending.map((p, i) => `${i + 1}. ${p.game_name}（${p.discord_account}）`).join('\n')
    const idx = parseInt(prompt('指到哪筆預約?輸入編號:\n' + list)) - 1
    if (isNaN(idx) || !pending[idx]) return
    const { error } = await supabase.rpc('link_to_pending', { target_id: userId, pending_id: pending[idx].id })
    if (error) { setMsg('指定失敗:' + error.message); return }
    setMsg('已指定並收押'); load()
  }

  const rosterIds = roster.map(r => r.member_id)
  const availableInmates = inmates.filter(p => !rosterIds.includes(p.id))

  return (
    <div>
      <h3>場次管理</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input placeholder="場次名(如 6/14 晚場)" value={sessionTitle} onChange={e => setSessionTitle(e.target.value)} />
        <button onClick={openSession}>開新場次</button>
      </div>
      <div style={{ marginBottom: 8 }}>
        目前場次:
        <select value={currentSession} onChange={e => setCurrentSession(e.target.value)} style={{ marginLeft: 6 }}>
          <option value="">— 選擇場次 —</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {currentSession && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          報到:
          <select value={pickInmate} onChange={e => setPickInmate(e.target.value)}>
            <option value="">— 選犯人 —</option>
            {availableInmates.map(p => <option key={p.id} value={p.id}>No.{String(p.inmate_no).padStart(4,'0')} {p.game_name ?? p.display_name}</option>)}
          </select>
          <button onClick={checkIn}>報到進本場</button>
        </div>
      )}
      {msg && <p style={{ color: '#2a7' }}>{msg}</p>}

      <h3 style={{ marginTop: 20 }}>本場名單</h3>
      {roster.length === 0 ? <p style={{ color: '#888' }}>本場還沒有人</p> : (
        <ul>{roster.map(r => <li key={r.id}>No.{String(r.profiles?.inmate_no).padStart(4,'0')} · {r.profiles?.game_name ?? r.profiles?.display_name}（{r.state}）</li>)}</ul>
      )}

      <h3 style={{ marginTop: 24 }}>新增預約犯人</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input placeholder="遊戲暱稱" value={form.game_name} onChange={e => setForm({ ...form, game_name: e.target.value })} />
        <input placeholder="Discord 使用者名稱" value={form.discord_account} onChange={e => setForm({ ...form, discord_account: e.target.value })} />
        <input placeholder="頭貼網址(選填)" value={form.avatar_url} onChange={e => setForm({ ...form, avatar_url: e.target.value })} />
        <button onClick={addPending}>加入預約</button>
      </div>

      <h3 style={{ marginTop: 24, color: '#c60' }}>⚠️ 未配對登入者</h3>
      {unmatched.length === 0 ? <p style={{ color: '#888' }}>沒有未配對的人</p> : (
        <ul>{unmatched.map(p => (
          <li key={p.id} style={{ marginBottom: 8 }}>{p.discord_account}
            <button onClick={() => linkToPending(p.id)} style={{ marginLeft: 10 }}>指到預約</button>
            <button onClick={() => admitDirect(p.id)} style={{ marginLeft: 6 }}>直接收押</button>
          </li>))}</ul>
      )}

      <h3 style={{ marginTop: 24 }}>預約名單</h3>
      {pending.length === 0 ? <p style={{ color: '#888' }}>目前沒有預約</p> : (
        <ul>{pending.map(p => <li key={p.id}>{p.game_name}（{p.discord_account}）</li>)}</ul>
      )}

      <h3 style={{ marginTop: 24 }}>在押名單(全部)</h3>
      {inmates.length === 0 ? <p style={{ color: '#888' }}>還沒有人在押</p> : (
        <ul>{inmates.map(p => <li key={p.id}>No.{String(p.inmate_no).padStart(4,'0')} · {p.game_name ?? p.display_name}</li>)}</ul>
      )}
    </div>
  )
}

export default App