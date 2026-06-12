import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { zhAuthError } from './authText'
import { INTERNAL_ACCOUNT_DOMAIN } from './authConfig'
import ManuscriptManager from './ManuscriptManager'
import SessionGoals from './SessionGoals'
import GuardWork from './GuardWork'
import GuardMemosTab from './GuardMemosTab'
import WardenPanel from './warden/WardenPanel'
import ProfilePage from './ProfilePage'
import RecordsPage from './RecordsPage'
import GuardRecordsPage from './GuardRecordsPage'
import MyBookings from './MyBookings'
import MessageBanner from './MessageBanner'
import DeadlinePrisonLoader from './DeadlinePrisonLoader'
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

// 密碼重設深連結偵測:模組載入當下「同步」記住 hash 是否為 recovery。
// supabase-js 的 detectSessionInUrl 會在初始化時消化並清掉 hash,React 訂閱
// onAuthStateChange 前事件可能已發完(時序競態),所以以這個同步嗅探為主、
// PASSWORD_RECOVERY 事件為輔(雙保險),擇穩定者 —— 兩者任一命中都進「設定新密碼」。
const HAD_RECOVERY_HASH = window.location.hash.includes('type=recovery')

function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('session')
  const [tabResolved, setTabResolved] = useState(false) // 落地分頁是否已決定:決定前遮 loading,避免用初始 tab 先渲染一次(閃過 session/booking)
  const [msg, setMsg] = useState('')
  const [myLive, setMyLive] = useState(null) // { sessionId, roleInSession, status } | null:我所在「未結束」場次(0 或 1)
  const [testError, setTestError] = useState(null)
  const [testBusy, setTestBusy] = useState(false)
  // ---- 信箱／帳號登入、忘記密碼(站內唯一登入通道;註冊已移除,帳號由典獄長開立) ----
  const [authMode, setAuthMode] = useState('login')  // 'login' | 'forgot'
  const [emailVal, setEmailVal] = useState('')
  const [pwVal, setPwVal] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authErr, setAuthErr] = useState(null)
  const [authNotice, setAuthNotice] = useState(null) // 驗證信/重設信已寄出等成功提示
  // ---- 密碼重設(recovery 深連結進站) ----
  const [recovery, setRecovery] = useState(HAD_RECOVERY_HASH)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryErr, setRecoveryErr] = useState(null)
  // ---- 首次登入強制改密碼(典獄長代開帳號:user_metadata.must_change_password) ----
  const [mcPw, setMcPw] = useState('')
  const [mcPw2, setMcPw2] = useState('')
  const [mcBusy, setMcBusy] = useState(false)
  const [mcErr, setMcErr] = useState(null)
  // ---- 建檔失敗重試(不讓使用者卡在空白畫面) ----
  const [profileErr, setProfileErr] = useState(null)
  const [profileRetry, setProfileRetry] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((e, session) => {
      // 雙保險之二:hash 已被 supabase-js 先清掉時,仍能由事件補捉 recovery
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) { setProfile(null); setProfileErr(null); setLoading(false); return }
    let alive = true
    async function init() {
      setLoading(true)
      setProfileErr(null)
      const cols = 'inmate_no, display_name, avatar_url, game_name, role'
      try {
        // 先查 profile：查得到就直接用，不跑配對。
        // 這保護了測試帳號（profiles.id 已綁定）—— 它們不會被 claim_profile 影響/覆蓋。
        const first = await supabase.from('profiles').select(cols).eq('id', user.id).maybeSingle()
        if (first.error) throw first.error
        let p = first.data
        // 查不到才是首次登入者（profile 還是 pending）→ 依登入通道建檔再重撈
        if (!p) {
          if (user.app_metadata?.provider === 'email') {
            // email 首次登入:走同一個 claim_profile 建檔發號(與 Discord 同一條編號指派路徑),
            // 頭像帶站內預設囚犯頭像;display_name 由下方回填段補進 profiles(RPC 無此參數)
            const { error: claimErr } = await supabase.rpc('claim_profile', { p_avatar_url: '/default-avatar.svg' })
            if (claimErr) throw claimErr
          } else {
            // Discord:維持現狀(RPC 內讀 OAuth metadata 填 display_name / discord_account)
            const { error: claimErr } = await supabase.rpc('claim_profile')
            if (claimErr) throw claimErr
          }
          const res = await supabase.from('profiles').select(cols).eq('id', user.id).maybeSingle()
          if (res.error) throw res.error
          p = res.data
        }
        if (!p) throw new Error('建檔後仍查無囚籍資料')
        // email 通道:只對 null 欄位回填(獄中名號取註冊時 signUp options.data 留的 display_name)。
        // 也涵蓋「先在官網報名(那裡的 claim_profile 不帶這些值)才首次進 /app」的情況;
        // 透過既有 RLS profiles_update_self 由本人寫入,失敗不阻斷進站(顯示處有 fallback)。
        if (user.app_metadata?.provider === 'email') {
          const name = (user.user_metadata?.display_name ?? '').trim()
          const patch = {}
          if (!p.display_name && name) patch.display_name = name
          if (!p.avatar_url) patch.avatar_url = '/default-avatar.svg'
          if (Object.keys(patch).length) {
            const { error: patchErr } = await supabase.from('profiles').update(patch).eq('id', user.id)
            if (!patchErr) Object.assign(p, patch)
          }
        }
        if (alive) setProfile(p)
      } catch {
        if (alive) setProfileErr('囚籍資料建立失敗，請重試。若持續失敗請聯繫典獄長。')
      }
      if (alive) setLoading(false)
    }
    init()
    return () => { alive = false }
  }, [user, profileRetry])

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
    let alive = true
    setTabResolved(false)
    if (profile.role === 'warden') {
      if (alive) { setTab('warden'); setTabResolved(true) }
      return
    }
    const landing = myLive?.roleInSession === 'guard' ? 'guardwork'
      : myLive?.roleInSession === 'inmate' ? 'session'
      : 'booking'
    if (alive) { setTab(landing); setTabResolved(true) }
    return () => { alive = false }
  }, [profile?.role, myLive?.roleInSession])

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' })   // 先確實清掉本地 session 再導頁(避免跳太快、新頁面讀到殘留 session)
    window.location.replace('/')                       // replace 不留 /app 在瀏覽歷史
  }

  // ⚠️ 測試專用：用 Email/密碼登入測試帳號（真實登入＝真實 RLS 權限）
  async function testSignIn(account) {
    setTestError(null)
    setTestBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: account.email, password: account.password })
    if (error) setTestError(error.message)
    setTestBusy(false)
  }

  // ---- Email 通道:登入 / 註冊 / 忘記密碼 ----
  function switchAuthMode(mode) {
    setAuthMode(mode); setAuthErr(null); setAuthNotice(null)
  }
  async function emailSignIn(e) {
    e.preventDefault()
    setAuthErr(null); setAuthNotice(null)
    const raw = emailVal.trim()
    if (!raw || !pwVal) { setAuthErr('請輸入信箱／帳號與密碼'); return }
    // 不含 @ → 視為典獄長代開的帳號名,補上內部後綴;含 @ → 一般 email,維持原行為
    const email = raw.includes('@') ? raw : `${raw.toLowerCase()}@${INTERNAL_ACCOUNT_DOMAIN}`
    setAuthBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: pwVal })
    setAuthBusy(false)
    if (error) setAuthErr(zhAuthError(error.message))
    // 成功時 onAuthStateChange 會帶 user 進站,這裡不用做事
  }
  async function sendReset(e) {
    e.preventDefault()
    setAuthErr(null); setAuthNotice(null)
    if (!emailVal.trim()) { setAuthErr('請輸入信箱'); return }
    // 代開帳號(無 @)的假 email 收不到信,密碼由典獄長後台重設
    if (!emailVal.trim().includes('@')) { setAuthErr('此類帳號請聯繫典獄長重設密碼'); return }
    setAuthBusy(true)
    // redirectTo 指向 /app:連結點開後 hash 帶 type=recovery,由上方雙保險偵測進「設定新密碼」
    const { error } = await supabase.auth.resetPasswordForEmail(emailVal.trim(), {
      redirectTo: window.location.origin + '/app',
    })
    setAuthBusy(false)
    if (error) { setAuthErr(zhAuthError(error.message)); return }
    setAuthNotice('重設信已寄出，請至信箱開啟連結設定新密碼。')
  }
  async function submitNewPassword(e) {
    e.preventDefault()
    setRecoveryErr(null)
    if (newPw.length < 8) { setRecoveryErr('密碼至少需 8 碼'); return }
    if (newPw !== newPw2) { setRecoveryErr('兩次輸入的密碼不一致'); return }
    setRecoveryBusy(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setRecoveryBusy(false); setRecoveryErr(zhAuthError(error.message)); return }
    // 沿用既有 replace 手法清掉殘留 hash(避免 # 汙染後續 OAuth redirect),並以乾淨 URL 重新進站
    window.location.replace(window.location.pathname)
  }

  // 首登強制改密碼:成功後同步清旗標,主畫面 gate 解除、走既有 tabResolved 流程進站
  async function submitFirstPassword(e) {
    e.preventDefault()
    setMcErr(null)
    if (mcPw.length < 8) { setMcErr('密碼至少需 8 碼'); return }
    if (mcPw !== mcPw2) { setMcErr('兩次輸入的密碼不一致'); return }
    setMcBusy(true)
    const { data, error } = await supabase.auth.updateUser({
      password: mcPw,
      data: { must_change_password: false },
    })
    setMcBusy(false)
    if (error) { setMcErr(zhAuthError(error.message)); return }
    // onAuthStateChange 的 USER_UPDATED 也會更新 user,這裡直接同步免等事件
    if (data?.user) setUser(data.user)
    setMcPw(''); setMcPw2('')
  }

  // 密碼重設深連結:不走一般登入/進站,先讓使用者把新密碼設完(成功後 replace 清 hash 重新進站)
  if (recovery) return (
    <DeadlinePrisonLoader status="重設密碼" statusEn="RESET PASSWORD" procLabel="身分核對">
      <div className="dpl-gate">
        <form className="dpl-mail" onSubmit={submitNewPassword}>
          <p className="dpl-mail-t">設定新密碼</p>
          <input className="dpl-inp" type="password" placeholder="新密碼（至少 8 碼）" value={newPw}
            autoComplete="new-password" onChange={e => setNewPw(e.target.value)} />
          <input className="dpl-inp" type="password" placeholder="再次輸入新密碼" value={newPw2}
            autoComplete="new-password" onChange={e => setNewPw2(e.target.value)} />
          {recoveryErr && <p className="dpl-err">{recoveryErr}</p>}
          <button className="dpl-btn" type="submit" disabled={recoveryBusy}>
            {recoveryBusy ? '設定中…' : '確認設定新密碼'}
          </button>
        </form>
        <a className="dpl-back" href="/">← 回到監獄入口</a>
      </div>
    </DeadlinePrisonLoader>
  )

  if (!user) return (
    <DeadlinePrisonLoader status="等候收容" statusEn="AWAITING INTAKE" procLabel="身分核對">
      <div className="dpl-gate">
        {/* Email 主通道:登入 / 註冊 / 忘記密碼 切換式表單 */}
        {authMode === 'login' && (
          <form className="dpl-mail" onSubmit={emailSignIn}>
            {/* type=text:代開帳號只輸入帳號名(不含 @),不能用瀏覽器的 email 格式驗證 */}
            <input className="dpl-inp" type="text" placeholder="信箱或帳號" value={emailVal}
              autoComplete="username" onChange={e => setEmailVal(e.target.value)} />
            <input className="dpl-inp" type="password" placeholder="密碼" value={pwVal}
              autoComplete="current-password" onChange={e => setPwVal(e.target.value)} />
            <div className="dpl-mail-row">
              <a className="dpl-lnk" onClick={() => switchAuthMode('forgot')}>忘記密碼？</a>
            </div>
            {authErr && <p className="dpl-err">{authErr}</p>}
            {authNotice && <p className="dpl-ok">{authNotice}</p>}
            <button className="dpl-btn" type="submit" disabled={authBusy}>{authBusy ? '登入中…' : '登入入獄'}</button>
          </form>
        )}
        {authMode === 'forgot' && (
          <form className="dpl-mail" onSubmit={sendReset}>
            <p className="dpl-mail-t">輸入信箱，我們會寄出密碼重設信</p>
            <input className="dpl-inp" type="email" placeholder="信箱" value={emailVal}
              autoComplete="email" onChange={e => setEmailVal(e.target.value)} />
            {authErr && <p className="dpl-err">{authErr}</p>}
            {authNotice && <p className="dpl-ok">{authNotice}</p>}
            <button className="dpl-btn" type="submit" disabled={authBusy}>{authBusy ? '寄送中…' : '寄送重設信'}</button>
            <p className="dpl-swap"><a className="dpl-lnk" onClick={() => switchAuthMode('login')}>← 返回登入</a></p>
          </form>
        )}

        <p className="dpl-choose">目前不開放自行註冊：已有帳號請直接登入；新帳號由典獄長開立後轉交。</p>

        <div className="dpl-privacy">
          <span className="dpl-pv-t">隱私說明</span>
          <p>・本站僅保存你的信箱／帳號與加密後的密碼,不會用於任何其他用途。</p>
          <p>・早期以 Discord 登入建立的帳號,僅保存其 Discord 使用者名稱與 ID,用於識別身分。</p>
        </div>
        <a className="dpl-back" href="/">← 回到監獄入口</a>
      </div>
      {import.meta.env.DEV && (
        <div className="test-box">
          <p className="t-title">⚠️ 測試專用（僅開發模式）</p>
          <p className="t-sub">正式上線（production build）不會出現此區塊</p>
          <div className="t-list">
            {TEST_ACCOUNTS.map((acc) => (
              <button key={acc.email} onClick={() => testSignIn(acc)} disabled={testBusy}>
                {acc.label}
              </button>
            ))}
          </div>
          {testError && <p className="banner err" style={{ marginTop: 12 }}>登入失敗：{testError}</p>}
        </div>
      )}
    </DeadlinePrisonLoader>
  )
  // 首次登入強制改密碼(典獄長代開帳號):在 auth 確立之後、主畫面之前全畫面攔截,
  // 不可跳過、不可進任何分頁;改完旗標清除,gate 自動解除走既有 tabResolved 流程。
  // recovery 深連結分支在更前面 return,兩者不會同時出現。
  if (user.user_metadata?.must_change_password === true) return (
    <DeadlinePrisonLoader status="設定新密碼" statusEn="SET NEW PASSWORD" procLabel="首次登入">
      <div className="dpl-gate">
        <form className="dpl-mail" onSubmit={submitFirstPassword}>
          <p className="dpl-mail-t">首次登入，請設定您的新密碼</p>
          <input className="dpl-inp" type="password" placeholder="新密碼（至少 8 碼）" value={mcPw}
            autoComplete="new-password" onChange={e => setMcPw(e.target.value)} />
          <input className="dpl-inp" type="password" placeholder="再次輸入新密碼" value={mcPw2}
            autoComplete="new-password" onChange={e => setMcPw2(e.target.value)} />
          {mcErr && <p className="dpl-err">{mcErr}</p>}
          <button className="dpl-btn" type="submit" disabled={mcBusy}>
            {mcBusy ? '設定中…' : '確認設定並進站'}
          </button>
        </form>
        <a className="dpl-back" onClick={signOut} style={{ cursor: 'pointer' }}>← 登出</a>
      </div>
    </DeadlinePrisonLoader>
  )
  if (loading) return <DeadlinePrisonLoader status="收容中" statusEn="INTAKE OPEN" procLabel="核對身分" />
  if (!profile) {
    // 建檔失敗:給中文錯誤 + 重試,不讓使用者卡在空白畫面
    return (
      <DeadlinePrisonLoader status="建檔中" statusEn="REGISTERING" procLabel="建立囚籍資料">
        <div className="dpl-gate">
          {profileErr && <p className="dpl-err">{profileErr}</p>}
          {profileErr && <button className="dpl-btn" onClick={() => setProfileRetry(n => n + 1)}>重試建檔</button>}
          <a className="dpl-back" onClick={signOut} style={{ cursor: 'pointer' }}>登出</a>
        </div>
      </DeadlinePrisonLoader>
    )
  }
  // 落地分頁尚未決定前先遮 loading,避免用初始 tab 閃過 session/booking
  if (!tabResolved) return <DeadlinePrisonLoader status="收容中" statusEn="INTAKE OPEN" procLabel="核對身分" />

  const isStaff = profile.role === 'guard' || profile.role === 'warden'
  // 互斥分頁:依「我目前未結束場次的本場身分」啟用「犯人服刑」/「獄卒作業」,跟著 myLive 輪詢即時重算。
  const inmateOK = myLive?.roleInSession === 'inmate'
  const guardOK = myLive?.roleInSession === 'guard'
  const tabs = profile.role === 'warden'
    ? [
        { k: 'warden', label: '典獄長主控台' },
        { k: 'session', label: '犯人服刑', disabled: !inmateOK },
        { k: 'guardwork', label: '獄卒作業', disabled: !guardOK },
        { k: 'memos', label: 'MEMO / 確認項' },
        { k: 'booking', label: '已預約場次' },
        { k: 'me', label: '我的稿件' },
        { k: 'records', label: '服刑紀錄' },
        { k: 'guardrecords', label: '看守紀錄' },
        { k: 'profile', label: '個人資料' },
      ]
    : profile.role === 'guard'
      ? [
          { k: 'session', label: '犯人服刑', disabled: !inmateOK },
          { k: 'guardwork', label: '獄卒作業', disabled: !guardOK },
          { k: 'memos', label: 'MEMO / 確認項' },
          { k: 'booking', label: '已預約場次' },
          { k: 'me', label: '我的稿件' },
          { k: 'records', label: '服刑紀錄' },
          { k: 'guardrecords', label: '看守紀錄' },
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
  const lockedHint = { session: '你目前不在任何進行中場次，或本場身分不是犯人', guardwork: '你目前不在任何進行中場次，或本場身分不是獄卒' }
  // 防呆:tab 不在當前身分的分頁清單時,落回第一個
  const activeTab = tabs.some(t => t.k === tab) ? tab : tabs[0].k
  return (
    <div className="admin">
      <div className="topbar">
        <a className="logo" href="/" title="回到監獄入口">死線<b>監獄</b></a>
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
            : <LockedSessionNote text="目前不在任何進行中場次（犯人），可至『已預約場次』報名或等待典獄長收監。" onGoToBooking={() => setTab('booking')} />
        )}
        {activeTab === 'guardwork' && (
          guardOK
            ? <SessionView userId={user.id} forceView="guard" onGoToManuscripts={() => setTab('me')} />
            : <LockedSessionNote text="目前不在任何進行中場次（獄卒），等待典獄長指派。" onGoToBooking={() => setTab('booking')} />
        )}
        {activeTab === 'memos' && isStaff && <GuardMemosTab userId={user.id} />}
        {activeTab === 'booking' && <MyBookings userId={user.id} onGoToManuscripts={() => setTab('me')} />}
        {activeTab === 'me' && (
          <div className="ms-page">
            <p className="muted" style={{ marginBottom: 4 }}>📍 我的稿件 · 遊戲暱稱：{profile.game_name ?? '（未設定）'}</p>
            <h3>稿件管理</h3>
            <ManuscriptManager userId={user.id} />
          </div>
        )}
        {activeTab === 'warden' && isStaff && <WardenPanel myRole={profile.role} userId={user.id} onGoToManuscripts={() => setTab('me')} />}
        {activeTab === 'records' && <RecordsPage userId={user.id} role={profile.role} />}
        {activeTab === 'guardrecords' && isStaff && <GuardRecordsPage userId={user.id} />}
        {activeTab === 'profile' && (
          <ProfilePage userId={user.id} role={profile.role}
            onSaved={(patch) => setProfile(p => ({ ...p, ...patch }))} />
        )}
      </div>
    </div>
  )
}

export default App
