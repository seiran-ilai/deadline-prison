import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import ManuscriptManager from './ManuscriptManager'
import SessionGoals from './SessionGoals'
import GuardWork from './GuardWork'
import WardenPanel from './warden/WardenPanel'
import ProfilePage from './ProfilePage'
import RecordsPage from './RecordsPage'
import MyBookings from './MyBookings'
import MessageBanner from './MessageBanner'
import { normalizeStatus } from './warden/constants'
import './styles/admin.css'

// 服刑視圖:犯人頁(SessionGoals)/ 獄卒頁(GuardWork)。
//  - forceView 給定('inmate'|'guard')時直接渲染對應視圖,不自行判斷本場身分
//    (互斥分頁的解鎖由外層 App 的 myLive gating 決定,避免兩處判斷不一致)。
//  - forceView 未給定時維持舊行為:自行抓本場 role_in_session 決定犯人/獄卒視圖。
function SessionView({ userId, onGoToManuscripts, forceView }) {
  const [roleInSession, setRoleInSession] = useState(undefined) // undefined=載入中, null=未報到, 'inmate'|'guard'
  useEffect(() => {
    if (forceView) return   // 外層已指定視圖,免查
    let alive = true
    async function load() {
      const { data: si } = await supabase.from('session_inmates')
        .select('session_id, role_in_session').eq('member_id', userId)
      if (!si || !si.length) { if (alive) setRoleInSession(null); return }
      // 全撈 + normalizeStatus 過濾(過渡期 DB 仍可能有舊值 open/closed,不用 .eq('status','open'))
      const { data: rows } = await supabase.from('sessions')
        .select('id, status, timer_started_at').in('id', si.map(r => r.session_id))
      const live = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended')
      const sess = live[0] ?? null
      const row = sess ? si.find(r => r.session_id === sess.id) : null
      if (alive) setRoleInSession(row ? row.role_in_session : null)
    }
    load()
    return () => { alive = false }
  }, [userId, forceView])
  // 防呆:userId 尚未就緒(首次登入流程)時不掛載任何場次查詢
  if (!userId) return null
  const view = forceView ?? roleInSession
  if (view === undefined) return <p style={{ color: '#888' }}>讀取本場身分中…</p>
  return view === 'guard' ? <GuardWork userId={userId} /> : <SessionGoals userId={userId} onGoToManuscripts={onGoToManuscripts} />
}

// 互斥分頁未解鎖時的置中提示卡(.admin 風格):說明原因 + 一鍵前往已預約場次
function LockedSessionNote({ text, onGoToBooking }) {
  return (
    <div className="locked-note">
      <p>{text}</p>
      <button className="btn-pri" onClick={onGoToBooking}>前往已預約場次</button>
    </div>
  )
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
  const [msg, setMsg] = useState('')
  const [myLive, setMyLive] = useState(null) // { sessionId, roleInSession, status } | null:我所在「未結束」場次(0 或 1)
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

  // 「我目前所在的未結束場次」即時輪詢(每 10 秒)—— tab 解鎖 + 落地分頁的唯一真相。
  // 典獄長更新場次狀態 / 把人收進場後,使用者不用重登,輪詢重算就會解鎖對應分頁。
  useEffect(() => {
    if (!profile) return
    let alive = true
    async function pull() {
      const { data: si } = await supabase.from('session_inmates')
        .select('session_id, role_in_session').eq('member_id', user.id)
      let live = null
      if (si && si.length) {
        const { data: rows } = await supabase.from('sessions')
          .select('id, status, timer_started_at').in('id', si.map(r => r.session_id))
        const liveRow = (rows ?? []).find(s => normalizeStatus(s) !== 'ended')
        if (liveRow) {
          const mine = si.find(r => r.session_id === liveRow.id)
          live = { sessionId: liveRow.id, roleInSession: mine?.role_in_session ?? 'inmate', status: normalizeStatus(liveRow) }
        }
      }
      if (alive) setMyLive(live)
    }
    pull()
    const t = setInterval(pull, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [profile?.role, user?.id])

  // 登入後落地分頁(依 myLive 重算):典獄長→主控台;在場且為獄卒→獄卒作業、犯人→犯人服刑;否則→已預約場次。
  // 依賴 myLive:首次 null 會先落 booking,輪詢抓到在場後自動帶到對的分頁 —— 即「不用重登就解鎖」。
  useEffect(() => {
    if (!profile) return
    if (profile.role === 'warden') { setTab('warden'); return }
    if (myLive?.roleInSession === 'guard') setTab('guardwork')
    else if (myLive?.roleInSession === 'inmate') setTab('session')
    else setTab('booking')
  }, [profile?.role, myLive?.roleInSession])

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
  if (!profile) {
    return (
      <div className="admin">
        <div className="center-box">
          <h1>死線<b>監獄</b></h1>
          <p className="sub">建立資料中…</p>
          <button onClick={signOut}>登出</button>
        </div>
      </div>
    )
  }

  const isStaff = profile.role === 'guard' || profile.role === 'warden'
  // 互斥分頁:依「我目前未結束場次的本場身分」啟用「犯人服刑」/「獄卒作業」,跟著 myLive 輪詢即時重算。
  const inmateOK = myLive?.roleInSession === 'inmate'
  const guardOK = myLive?.roleInSession === 'guard'
  const tabs = profile.role === 'warden'
    ? [
        { k: 'warden', label: '典獄長主控台' },
        { k: 'session', label: '犯人服刑', disabled: !inmateOK },
        { k: 'guardwork', label: '獄卒作業', disabled: !guardOK },
        { k: 'booking', label: '已預約場次' },
        { k: 'me', label: '我的稿件' },
        { k: 'records', label: '服刑紀錄' },
        { k: 'profile', label: '個人資料' },
      ]
    : profile.role === 'guard'
      ? [
          { k: 'session', label: '犯人服刑', disabled: !inmateOK },
          { k: 'guardwork', label: '獄卒作業', disabled: !guardOK },
          { k: 'booking', label: '已預約場次' },
          { k: 'me', label: '我的稿件' },
          { k: 'records', label: '服刑紀錄' },
          { k: 'profile', label: '個人資料' },
        ]
      : [
          { k: 'session', label: '犯人服刑', disabled: !inmateOK },
          { k: 'booking', label: '已預約場次' },
          { k: 'me', label: '我的稿件' },
          { k: 'records', label: '服刑紀錄' },
          { k: 'profile', label: '個人資料' },
        ]
  // disabled 分頁的點擊提示(hover title 同字)
  const lockedHint = { session: '你目前不在任何進行中場次,或本場身分不是犯人', guardwork: '你目前不在任何進行中場次,或本場身分不是獄卒' }
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
          // disabled 分頁不用 native disabled(否則點不到):用 tab-disabled 灰樣式 + 點擊跳 setMsg 提示
          <button key={t.k} aria-disabled={t.disabled || undefined}
            title={t.disabled ? lockedHint[t.k] : undefined}
            className={`${activeTab === t.k ? 'on' : ''}${t.disabled ? ' tab-disabled' : ''}`}
            onClick={() => t.disabled ? setMsg(lockedHint[t.k]) : setTab(t.k)}>{t.label}</button>
        ))}
      </div>
      <MessageBanner msg={msg} onClose={() => setMsg('')} />
      <div className="page">
        {activeTab === 'session' && (
          inmateOK
            ? <SessionView userId={user.id} forceView="inmate" onGoToManuscripts={() => setTab('me')} />
            : <LockedSessionNote text="目前不在任何進行中場次(犯人),可至『已預約場次』報名或等待典獄長收監。" onGoToBooking={() => setTab('booking')} />
        )}
        {activeTab === 'guardwork' && (
          guardOK
            ? <SessionView userId={user.id} forceView="guard" onGoToManuscripts={() => setTab('me')} />
            : <LockedSessionNote text="目前不在任何進行中場次(獄卒),等待典獄長指派。" onGoToBooking={() => setTab('booking')} />
        )}
        {activeTab === 'booking' && <MyBookings userId={user.id} onGoToManuscripts={() => setTab('me')} />}
        {activeTab === 'me' && (
          <div className="ms-page">
            <p className="muted" style={{ marginBottom: 4 }}>📍 我的稿件 · 遊戲暱稱:{profile.game_name ?? '(未設定)'}</p>
            <h3>稿件管理</h3>
            <ManuscriptManager userId={user.id} />
          </div>
        )}
        {activeTab === 'warden' && isStaff && <WardenPanel myRole={profile.role} userId={user.id} onGoToManuscripts={() => setTab('me')} />}
        {activeTab === 'records' && <RecordsPage userId={user.id} role={profile.role} />}
        {activeTab === 'profile' && (
          <ProfilePage userId={user.id} role={profile.role}
            onSaved={(patch) => setProfile(p => ({ ...p, ...patch }))} />
        )}
      </div>
    </div>
  )
}

export default App
