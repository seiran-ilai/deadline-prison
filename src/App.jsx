import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import ManuscriptManager from './ManuscriptManager'
import SessionGoals from './SessionGoals'
import GuardWork from './GuardWork'
import WardenPanel from './warden/WardenPanel'
import './styles/admin.css'

// 本次服刑分頁:內容依「本場身分 role_in_session」決定(犯人頁 / 獄卒頁),
// 與全域 role 無關 —— 典獄長/獄卒被報到成本場犯人時也會看到犯人頁。
function SessionView({ userId }) {
  const [roleInSession, setRoleInSession] = useState(undefined) // undefined=載入中, null=未報到, 'inmate'|'guard'
  useEffect(() => {
    let alive = true
    async function load() {
      const { data: si } = await supabase.from('session_inmates')
        .select('session_id, role_in_session').eq('member_id', userId)
      if (!si || !si.length) { if (alive) setRoleInSession(null); return }
      const { data: open } = await supabase.from('sessions')
        .select('id').in('id', si.map(r => r.session_id)).eq('status', 'open')
      const row = (open && open.length) ? si.find(r => r.session_id === open[0].id) : null
      if (alive) setRoleInSession(row ? row.role_in_session : null)
    }
    load()
    return () => { alive = false }
  }, [userId])
  if (roleInSession === undefined) return <p style={{ color: '#888' }}>讀取本場身分中…</p>
  return roleInSession === 'guard' ? <GuardWork userId={userId} /> : <SessionGoals userId={userId} />
}

// ⚠️ 測試專用：開發測試帳號（只在 import.meta.env.DEV 時使用）
// 這些是 Supabase 上真實的 Email 測試帳號，profiles 已建好（role=guard/member）
// TODO: 把密碼填進來（測試帳號，明碼放前端沒關係，反正只在 npm run dev 出現）
const TEST_ACCOUNT_PASSWORD = 'test123'
const TEST_ACCOUNTS = [
  { label: '以獄卒測試登入（T001）', email: 'test001@test.com', password: TEST_ACCOUNT_PASSWORD },
  { label: '以犯人測試登入（T002）', email: 'test002@test.com', password: TEST_ACCOUNT_PASSWORD },
]

function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('session')
  const [testError, setTestError] = useState(null)
  const [testBusy, setTestBusy] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) { setProfile(null); setLoading(false); return }
    async function init() {
      setLoading(true)
      const cols = 'inmate_no, display_name, game_name, role'
      // 先查 profile：查得到就直接用，不跑配對。
      // 這保護了測試帳號（profiles.id 已綁定）—— 它們不會被 claim_profile 影響/覆蓋。
      let { data: p } = await supabase.from('profiles').select(cols).eq('id', user.id).maybeSingle()
      // 查不到才是 Discord 首次登入者（profile 還是 pending）→ 跑配對再重撈
      if (!p) {
        await supabase.rpc('claim_profile')
        const res = await supabase.from('profiles').select(cols).eq('id', user.id).maybeSingle()
        p = res.data
      }
      setProfile(p)
      setLoading(false)
    }
    init()
  }, [user])

  // 登入後依身分決定預設落地分頁:典獄長→主控台,其餘→本次服刑/獄卒作業
  useEffect(() => {
    if (!profile) return
    setTab(profile.role === 'warden' ? 'warden' : 'session')
  }, [profile?.role])

  // 登入後導回目前的監所系統頁(/app 或 /warden),而非公開首頁
  async function signIn() { await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: window.location.href } }) }
  async function signOut() { await supabase.auth.signOut() }

  // ⚠️ 測試專用：用 Email/密碼登入測試帳號（真實登入＝真實 RLS 權限）
  async function testSignIn(account) {
    setTestError(null)
    setTestBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password })
    if (error) setTestError(error.message)
    setTestBusy(false)
  }

  if (!user) return (
    <div className="admin">
      <div className="center-box">
        <h1>死線<b>監獄</b> · DEADLINE PRISON</h1>
        <button className="btn-pri" onClick={signIn}>用 Discord 登入</button>
        {import.meta.env.DEV && (
          <div className="test-box">
            <p className="t-title">⚠️ 測試專用(僅開發模式)</p>
            <p className="t-sub">正式上線(production build)不會出現此區塊</p>
            <div className="t-list">
              {TEST_ACCOUNTS.map((acc) => (
                <button key={acc.email} onClick={() => testSignIn(acc)} disabled={testBusy}>
                  {acc.label}
                </button>
              ))}
            </div>
            {testError && <p className="banner err" style={{ marginTop: 12 }}>登入失敗:{testError}</p>}
          </div>
        )}
      </div>
    </div>
  )
  if (loading) return <div className="admin"><div className="center-box"><p className="sub">核對身分中…</p></div></div>
  if (!profile || profile.inmate_no == null) {
    return (
      <div className="admin">
        <div className="center-box">
          <h1>死線<b>監獄</b></h1>
          <p className="sub">查無預約資料,請與典獄長確認</p>
          <a className="btn-ghost" href="https://discord.gg/你的邀請連結" target="_blank" rel="noreferrer">聯繫典獄長(Discord)</a>
          <button onClick={signOut}>登出</button>
        </div>
      </div>
    )
  }

  const isStaff = profile.role === 'guard' || profile.role === 'warden'
  // 分頁順序依全域 role:
  //  典獄長 → 主控台 / 我的稿件 / 本次服刑
  //  獄卒   → 獄卒作業 / 我的稿件
  //  犯人   → 本次服刑 / 我的稿件
  const tabs = profile.role === 'warden'
    ? [{ k: 'warden', label: '典獄長主控台' }, { k: 'me', label: '我的稿件' }, { k: 'session', label: '本次服刑' }]
    : profile.role === 'guard'
      ? [{ k: 'session', label: '獄卒作業' }, { k: 'me', label: '我的稿件' }]
      : [{ k: 'session', label: '本次服刑' }, { k: 'me', label: '我的稿件' }]
  // 防呆:tab 不在當前身分的分頁清單時,落回第一個
  const activeTab = tabs.some(t => t.k === tab) ? tab : tabs[0].k
  return (
    <div className="admin">
      <div className="topbar">
        <div className="logo">死線<b>監獄</b></div>
        <div className="who">
          <span className="num">No.{String(profile.inmate_no).padStart(4, '0')}</span>
          {profile.game_name ?? profile.display_name}
          <button className="btn-ghost" onClick={signOut}>登出</button>
        </div>
      </div>
      <div className="tabs">
        {tabs.map(t => (
          <button key={t.k} className={activeTab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>{t.label}</button>
        ))}
      </div>
      <div className="page">
        {activeTab === 'session' && <SessionView userId={user.id} />}
        {activeTab === 'me' && (
          <div>
            <p className="muted" style={{ marginBottom: 4 }}>📍 我的稿件 · 遊戲暱稱:{profile.game_name ?? '(未設定)'}</p>
            <h3>稿件管理</h3>
            <ManuscriptManager userId={user.id} />
          </div>
        )}
        {activeTab === 'warden' && isStaff && <WardenPanel myRole={profile.role} />}
      </div>
    </div>
  )
}

export default App
