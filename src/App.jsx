import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { zhAuthError } from './authText'
import ManuscriptManager from './ManuscriptManager'
import SessionGoals from './SessionGoals'
import GuardWork from './GuardWork'
import GuardMemosTab from './GuardMemosTab'
import WardenPanel from './warden/WardenPanel'
import ProfilePage from './ProfilePage'
import RecordsPage from './RecordsPage'
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

const DiscordIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.3 1.4 16.6 16.6 0 0 0-14.9 0A18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.4.3 17.8A20 20 0 0 0 6.4 21l.5-1.8a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1L17 21a20 20 0 0 0 6-3.2c.3-5.1-.5-9.4-2.7-13.4ZM8.4 15.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm7.2 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
  </svg>
)

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
  const [oauthUrl, setOauthUrl] = useState(null) // 預取的 Discord OAuth URL(登入鈕用真實 <a> 導航)
  const [testError, setTestError] = useState(null)
  const [testBusy, setTestBusy] = useState(false)
  // ---- Email 登入/註冊/忘記密碼(Discord OAuth 之外的第二通道) ----
  const [authMode, setAuthMode] = useState('login')  // 'login' | 'register' | 'forgot'
  const [emailVal, setEmailVal] = useState('')
  const [pwVal, setPwVal] = useState('')
  const [nameVal, setNameVal] = useState('')         // 註冊用:獄中名號(display_name)
  const [authBusy, setAuthBusy] = useState(false)
  const [authErr, setAuthErr] = useState(null)
  const [authNotice, setAuthNotice] = useState(null) // 驗證信/重設信已寄出等成功提示
  // ---- 密碼重設(recovery 深連結進站) ----
  const [recovery, setRecovery] = useState(HAD_RECOVERY_HASH)
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryErr, setRecoveryErr] = useState(null)
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

  // 未登入時預取 OAuth URL:登入鈕用真實 <a href> 導航(保留使用者手勢),
  // 行動端較可能由系統交給 Discord App 開授權頁,也避開非同步跳轉被瀏覽器擋下的情況。
  useEffect(() => {
    if (user) { setOauthUrl(null); return }
    let alive = true
    ;(async () => {
      const redirectTo = window.location.origin + window.location.pathname  // 乾淨路徑,不帶 hash/query
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: { redirectTo, scopes: 'identify', skipBrowserRedirect: true },
      })
      if (alive && data?.url) setOauthUrl(data.url)
    })()
    return () => { alive = false }
  }, [user])

  // 登入後導回目前的監所系統頁(/app 或 /warden),而非公開首頁(預取失敗時的 fallback)
  async function signIn() {
    const redirectTo = window.location.origin + window.location.pathname  // 乾淨路徑,不帶 hash/query
    await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo, scopes: 'identify' } })
  }
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
    if (!emailVal.trim() || !pwVal) { setAuthErr('請輸入信箱與密碼'); return }
    setAuthBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: emailVal.trim(), password: pwVal })
    setAuthBusy(false)
    if (error) setAuthErr(zhAuthError(error.message))
    // 成功時 onAuthStateChange 會帶 user 進站,這裡不用做事
  }
  async function emailSignUp(e) {
    e.preventDefault()
    setAuthErr(null); setAuthNotice(null)
    const name = nameVal.trim()
    if (!emailVal.trim()) { setAuthErr('請輸入信箱'); return }
    if (pwVal.length < 8) { setAuthErr('密碼至少需 8 碼'); return }
    if (name.length < 2 || name.length > 20) { setAuthErr('獄中名號需為 2–20 字'); return }
    setAuthBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: emailVal.trim(),
      password: pwVal,
      options: {
        data: { display_name: name },                          // 首次登入建檔時補進 profiles.display_name
        emailRedirectTo: window.location.origin + '/app',      // 驗證完成導回監獄系統
      },
    })
    setAuthBusy(false)
    if (error) { setAuthErr(zhAuthError(error.message)); return }
    // 信箱已註冊時 Supabase 不回錯誤(防探測),改回 identities 空陣列 → 視同已註冊
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setAuthErr('此信箱已註冊過，請直接登入'); return
    }
    setAuthNotice('驗證信已寄出，請至信箱完成確認後再回來登入。')
    setPwVal('')
  }
  async function sendReset(e) {
    e.preventDefault()
    setAuthErr(null); setAuthNotice(null)
    if (!emailVal.trim()) { setAuthErr('請輸入信箱'); return }
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
            <input className="dpl-inp" type="email" placeholder="信箱" value={emailVal}
              autoComplete="email" onChange={e => setEmailVal(e.target.value)} />
            <input className="dpl-inp" type="password" placeholder="密碼" value={pwVal}
              autoComplete="current-password" onChange={e => setPwVal(e.target.value)} />
            <div className="dpl-mail-row">
              <a className="dpl-lnk" onClick={() => switchAuthMode('forgot')}>忘記密碼？</a>
            </div>
            {authErr && <p className="dpl-err">{authErr}</p>}
            {authNotice && <p className="dpl-ok">{authNotice}</p>}
            <button className="dpl-btn" type="submit" disabled={authBusy}>{authBusy ? '登入中…' : '用信箱登入入獄'}</button>
            <p className="dpl-swap">還沒有帳號？<a className="dpl-lnk" onClick={() => switchAuthMode('register')}>註冊</a></p>
          </form>
        )}
        {authMode === 'register' && (
          <form className="dpl-mail" onSubmit={emailSignUp}>
            <input className="dpl-inp" type="email" placeholder="信箱" value={emailVal}
              autoComplete="email" onChange={e => setEmailVal(e.target.value)} />
            <input className="dpl-inp" type="password" placeholder="密碼（至少 8 碼）" value={pwVal}
              autoComplete="new-password" onChange={e => setPwVal(e.target.value)} />
            <input className="dpl-inp" type="text" placeholder="獄中名號（2–20 字，必填）" value={nameVal}
              maxLength={20} onChange={e => setNameVal(e.target.value)} />
            {authErr && <p className="dpl-err">{authErr}</p>}
            {authNotice && <p className="dpl-ok">{authNotice}</p>}
            <button className="dpl-btn" type="submit" disabled={authBusy}>{authBusy ? '註冊中…' : '註冊入獄'}</button>
            <p className="dpl-swap">已有帳號？<a className="dpl-lnk" onClick={() => switchAuthMode('login')}>登入</a></p>
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

        {/* Discord 輔助通道:真實 <a> 導航(行動端保留使用者手勢,較可能喚起 Discord App;URL 未就緒時 fallback JS 跳轉) */}
        <div className="dpl-or"><span /><em>或使用 Discord</em><span /></div>
        <a className="dpl-dc" href={oauthUrl ?? '#'}
          onClick={e => { if (!oauthUrl) { e.preventDefault(); signIn() } }}>
          <DiscordIcon />用 Discord 登入入獄
        </a>
        <p className="dpl-choose">請擇一方式註冊：信箱與 Discord 為兩個獨立帳號，請勿重複註冊。</p>

        <div className="dpl-privacy">
          <span className="dpl-pv-t">隱私說明</span>
          <p>・我們只取用你的 Discord 使用者名稱與 ID,用來建立個人資料、避免重複註冊。</p>
          <p>・Discord 授權會要求頭像、橫幅與 email,但本監獄不會儲存或使用其中任何一項。</p>
          <p>・使用信箱註冊時,本站僅保存你的信箱與加密後的密碼,不會用於任何其他用途。</p>
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
        {activeTab === 'profile' && (
          <ProfilePage userId={user.id} role={profile.role}
            onSaved={(patch) => setProfile(p => ({ ...p, ...patch }))} />
        )}
      </div>
    </div>
  )
}

export default App
