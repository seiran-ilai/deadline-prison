import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { zhAuthError } from '../authText'
import { SHOW_APP_ACCESS, INTERNAL_ACCOUNT_DOMAIN } from '../authConfig'
import { createBooking, createGuestBooking, cancelBooking } from '../bookingApi'
import { toSessionView, splitDate } from '../prison'
import { sessionKindLabel } from '../sessionKind'
import AvatarInput from '../AvatarInput'
import { SITE_INMATE_GUIDE } from '../tourSteps'
import './prison-site.css'

// 場次營運類型(每場只有一種屬性;服刑須知輪播用)。每型:三步卡片 + 節奏條。文字照抄不改寫。
const SERVING_TYPES = [
  {
    kind: '集體趕稿', marker: '// CRUNCH', rhythm: 'pomodoro', rhythmLbl: '服刑節奏 · POMODORO CYCLE',
    steps: [
      ['01', '自首入監', '註冊帳號、報名梯次，然後在指定時間抵達監獄大門，乖乖服刑。'],
      ['02', '適度休息', '專注 25 分鐘、放風 5 分鐘為一輪；每四輪一次長休 15 分鐘。健康的身體才是創作的本錢。'],
      ['03', '刑滿釋放', '梯次結束即收尾放人。趕完稿了嗎？拍拍屁股出獄去。還沒趕完稿？記得下次再來自首。'],
    ],
  },
  {
    kind: '指名互動', marker: '// NOMINATION', rhythm: 'slots', rhythmLbl: '時段節奏 · SESSION SLOTS', rhythmNote: '每 30 分為一時段・最少一段・可延長加時',
    steps: [
      ['01', '指名收監', '預約時指定想要的獄卒，選定時段完成登記。30 分鐘為一個時段。'],
      ['02', '專屬看管', '指定的獄卒全程陪同。聊天、演繹、討論進度，內容由你決定。'],
      ['03', '時段結束', '時間到即結束。意猶未盡？可當場加時，視獄卒檔期而定。'],
    ],
  },
  {
    kind: '自由入場', marker: '// FREE ENTRY', rhythm: 'free', rhythmLbl: '服刑節奏 · FREE FLOW', rhythmNote: '無固定循環・無獄卒管理・自由來去',
    steps: [
      ['01', '自由入監', '加入官方 DC，直接進入趕稿頻道。免報名、免費用。'],
      ['02', '無人看管', '沒有番茄鐘、沒有獄卒點名。節奏自己抓，進度自己顧。'],
      ['03', '來去自如', '想走就走，想留就留。這是一間無人看守的開放牢房。'],
    ],
  },
]

// 場次營運類型輪播:tab 切換 + 自動定時滑動 + 左右滑動(觸控/箭頭)。強調「每場屬性不同,非一場多種」。
function ServingTypesCarousel({ types }) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const touchX = useRef(null)
  useEffect(() => {
    if (paused) return
    const t = setInterval(() => setIdx(i => (i + 1) % types.length), 6500)
    return () => clearInterval(t)
  }, [paused, types.length])
  const go = i => setIdx((i + types.length) % types.length)
  // pointer 事件同時支援滑鼠拖曳與觸控滑動
  const onDown = e => { touchX.current = e.clientX }
  const onUp = e => {
    if (touchX.current == null) return
    const dx = e.clientX - touchX.current
    if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1))
    touchX.current = null
  }
  const rhythmBar = t => t.rhythm === 'pomodoro'
    ? (<><div className="bars"><i className="focus" /><i className="rest" /><i className="focus" /><i className="rest" /><i className="focus" /><i className="rest" /><i className="focus" /><i className="long" /></div>
        <div className="legend"><span><i style={{ background: 'var(--hazard)' }} />專注 25 分</span><span><i style={{ background: 'var(--steel)' }} />放風 5 分</span><span><i style={{ background: 'var(--alarm)' }} />長休 15 分（每 4 輪）</span></div></>)
    : t.rhythm === 'slots'
      ? (<><div className="bars"><i className="slot" /><i className="slot" /><i className="slot" /><i className="slot" /><i className="slot-add" /></div><div className="legend"><span>{t.rhythmNote}</span></div></>)
      : (<><div className="bars"><i className="flow"><em>自由服刑・無限循環</em></i></div><div className="legend"><span>{t.rhythmNote}</span></div></>)
  return (
    <div className="serving-carousel reveal" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="sc-tabs" role="tablist">
        {types.map((t, i) => (
          <button key={t.kind} role="tab" aria-selected={i === idx} className={`sc-tab${i === idx ? ' on' : ''}`} onClick={() => setIdx(i)}>{t.kind}</button>
        ))}
      </div>
      <div className="sc-viewport" style={{ touchAction: 'pan-y' }} onPointerDown={onDown} onPointerUp={onUp}>
        <div className="sc-track" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {types.map(t => (
            <div className="sc-slide" key={t.kind} aria-hidden={types[idx].kind !== t.kind}>
              <div className="eyebrow serving-sub">{t.kind} <span className="blk">{t.marker}</span></div>
              <div className="rules">
                {t.steps.map(([n, h, p]) => (
                  <div className="rule" key={n}><span className="pin" /><div className="rn">{n}</div><h3>{h}</h3><p>{p}</p></div>
                ))}
              </div>
              <div className="rhythm"><div className="lbl">{t.rhythmLbl}</div>{rhythmBar(t)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="sc-controls">
        <button className="sc-arrow" aria-label="上一個" onClick={() => go(idx - 1)}>‹</button>
        <div className="sc-dots">
          {types.map((t, i) => <button key={t.kind} className={`sc-dot${i === idx ? ' on' : ''}`} aria-label={t.kind} onClick={() => setIdx(i)} />)}
        </div>
        <button className="sc-arrow" aria-label="下一個" onClick={() => go(idx + 1)}>›</button>
      </div>
    </div>
  )
}

// 營業項目價目(RP 店收費;費用單位 W)
// 預約須知(文字照抄不改寫)。每條拆成 [序號, 標題, 內文]。集體趕稿與指名場皆適用。
const BOOKING_NOTICE = [
  ['一', '請加入官方 Discord', '每場營運都會在 DC 開設專屬頻道，當次的取消或異動一律在頻道內公告。加入後請把暱稱改成你的遊戲角色名，方便典獄長與獄卒點名辨識。', 'https://discord.gg/tpRn7En9mk'],
  ['二', '囚犯臨時無法出席', '請盡早在官方 DC 告知，方便典獄長重新安排當次的名額。'],
  ['三', '獄卒臨時無法執勤', '一般獄卒臨時無法執勤時，典獄長會協調其他有空的獄卒接手，並在 DC 公告。若無法執勤的是你的指名對象，典獄長會直接與你討論，看是改指名其他獄卒，或是擇日安排並保留你的優先指名權。'],
  ['四', '關於演繹的共同語言', '死線監獄的演繹，建立在「監獄」這項元素之上，並保留大量空白。這是本店刻意為之的設計，為的是讓每一位不同帶入程度的犯人都能立刻入戲，這個空間裡的每一句話，在場的每個人都能一起參與。演繹時請以監獄設定和遊戲內相關世界觀為主。若想帶入外部作品或圈外的梗也很歡迎，但請考量到在場獄卒、犯人能理解的程度不同，若無法接續演繹，還請見諒。'],
]

// 官網預約即時報價(單位:萬;顧客端估算,與後台結算 salaryRules.RATES 分開)。
//   crunch:入場 20 + 指定監督 10/位;named:指名 15/時段、無指名入場 1;拍立得 5/張、簽繪張 8/張;抓捕 30 起(委託人付)。
const PRICE = { crunchEntry: 20, supervise: 10, namedSlot: 15, namedEntry: 1, polaroid: 5, signAdd: 3, portrait: 80, captureBase: 30, captureAdd: 15 }


// 場次介紹:三種場次類型的「場次類型 / 場次介紹 / 場次品項」。文字照抄不改寫;品項以物件 { n,p,u,note,hot } 呈現。
const SESSION_TYPES = [
  {
    code: '01', kind: '集體趕稿', tagline: '番茄鐘團體趕稿',
    intro: '以番茄鐘節奏進行的團體監督趕稿，25 分鐘 × 4 循環，約 2 小時，獄卒在場監督記錄。人數上限 5 人／場。適合需要有人盯、喜歡一起衝節奏的囚犯。',
    items: [
      { n: '入場費', p: '20', u: '萬' },
      { n: '指定監督獄卒', p: '+10', u: '萬', note: '入場＋監督＝30 萬', hot: true },
      { n: '互動探監', p: '5', u: '萬', was: '10 萬', hot: true, note: '試營運限定・由探監者支付' },
      { n: '無互動探監', p: '免費', note: '純參觀' },
      { n: '拍立得（空白）', p: '5', u: '萬／張', note: '不限定當場獄卒，請等休息時間拍攝' },
      { n: '拍立得加購簽繪', p: '+3', u: '萬／張', note: '於空白拍立得加購', hot: true },
      { n: '監獄外抓捕', p: '30', u: '萬起', note: '最少 2 名獄卒抓捕' },
      { n: '肖像畫', p: '80', u: '萬', note: '限定負責獄卒上班日，無須入場即可繪製' },
    ],
  },
  {
    code: '02', kind: '指名互動', tagline: '獄卒 × 囚犯',
    intro: '指定一位獄卒的一對一互動時段，30 分鐘為一個時段，最少一個時段，可視情況延長。可聊天、演繹、討論進度，內容依需求安排。適合想要專屬陪伴、有特定指名對象的囚犯。',
    items: [
      { n: '指名費', p: '15', u: '萬／30 分鐘', note: '最少一個時段' },
      { n: '無指名入場', p: '1', u: '萬' },
      { n: '拍立得（空白）', p: '5', u: '萬／張', note: '不限定當場獄卒，請等休息時間拍攝' },
      { n: '拍立得加購簽繪', p: '+3', u: '萬／張', note: '於空白拍立得加購', hot: true },
      { n: '肖像畫', p: '80', u: '萬', note: '限定負責獄卒上班日，無須指名即可繪製' },
    ],
  },
  {
    code: '03', kind: '自由入場', tagline: '開放趕稿',
    intro: '開放 DC 自由進出的趕稿空間，無番茄鐘、無獄卒管理。自行安排節奏、自由來去。適合只想低壓力默默趕稿的囚犯。',
    items: [
      { n: '入場', p: '免費', note: '無獄卒管理' },
    ],
  },
]

// 場次狀態徽章(依 public_sessions 的 display_status;後端已過濾已結束場)
const SESS_STATUS = {
  booking:        { label: '預約中',   cls: 'booking' },  // 預約中(正向綠)
  booking_paused: { label: '報名暫停', cls: 'paused' },   // 報名暫停(中性灰)
  intake:         { label: '入場中',   cls: 'intake' },   // 入場中(中性灰)
  serving:        { label: '服刑中',   cls: 'serving' },  // 服刑中(強調色)
}

export default function PrisonSite() {
  const [sessions, setSessions] = useState([])
  const [staff, setStaff] = useState([])
  const [user, setUser] = useState(undefined)  // undefined=載入中, null=未登入
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)         // 開著的入監 modal 對應場次
  const [selBooking, setSelBooking] = useState(null) // 我在 sel 這場的預約(含 cancelled)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState(null)
  const [myProfile, setMyProfile] = useState(null)   // 預約者既有 profile(暱稱/頭像來源判定)
  const [bkName, setBkName] = useState('')           // 入監暱稱(預設帶既有 game_name)
  const [bkAvatar, setBkAvatar] = useState('')       // 入監頭像 URL(預設帶既有 avatar_url)
  const [menuOpen, setMenuOpen] = useState(false)    // 手機版漢堡選單開合
  const [pw, setPw] = useState('')                   // 密鑰場:輸入中的通行密鑰
  const [namedGuards, setNamedGuards] = useState([]) // 指名互動場:[{ guard_id, name, avatar, slots:[{index,label,taken}] }]
  const [reqSel, setReqSel] = useState(() => new Set())  // 指名選擇:Set of "guardId|slotIndex"(named 帶時格;crunch 監督用 "guardId|")
  const [addonsByGuard, setAddonsByGuard] = useState({}) // 每卒加購:{ [guardId]: { polaroid, sign } }
  const [capture, setCapture] = useState({ on: false, client: '', target: '', server: '', guards: 2 }) // 集體場「把朋友抓進去」(guards=抓捕獄卒人數)
  const [pwOk, setPwOk] = useState(false)            // 密鑰場:本次 modal 是否已通過核對
  const [pwChecking, setPwChecking] = useState(false)
  const [pwErr, setPwErr] = useState(null)           // 密鑰核對錯誤(留在關卡內顯示,可重試)
  const [mEmail, setMEmail] = useState('')            // modal 內登入:帳號名
  const [mPw, setMPw] = useState('')
  const [mAuthBusy, setMAuthBusy] = useState(false)
  const [mAuthErr, setMAuthErr] = useState(null)
  const [gName, setGName] = useState('')              // 不登入直接預約:遊戲暱稱
  const [gServer, setGServer] = useState('')          // 不登入直接預約:伺服器(與暱稱分兩欄)
  const [gPw, setGPw] = useState('')                  // 不註冊預約:密鑰場通行密鑰
  const [gBusy, setGBusy] = useState(false)
  const [gErr, setGErr] = useState(null)
  const rootRef = useRef(null)

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    setUser(session?.user ?? null)
    const [{ data: sess }, { data: st }] = await Promise.all([
      supabase.rpc('public_sessions'),
      supabase.rpc('public_staff'),
    ])
    setSessions((sess ?? []).map(toSessionView))
    setStaff((st ?? []).map(r => ({
      role: r.role === 'warden' ? '典獄長' : '獄卒',
      name: r.game_name || r.display_name || '——',
      img: r.avatar_url || '',
      bio: r.bio || '',   // 真實 bio;空則由顯示端補 fallback
    })))
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // 進場動畫 + 導覽 active(imperative;className prop 固定,React 不會清掉 classList)
  useEffect(() => {
    if (loading || !rootRef.current) return
    const root = rootRef.current
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
    }), { threshold: 0.15 })
    // 同一 section 內的 .reveal 依出現順序遞增進場延遲(上限 280ms)
    root.querySelectorAll('section').forEach(sec =>
      sec.querySelectorAll('.reveal').forEach((el, i) => { el.style.transitionDelay = `${Math.min(i * 70, 280)}ms` }))
    root.querySelectorAll('.reveal').forEach(el => io.observe(el))
    const navIO = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        root.querySelectorAll('nav .links a').forEach(a =>
          a.classList.toggle('active', a.getAttribute('data-sec') === e.target.id))
      }
    }), { rootMargin: '-50% 0px -50% 0px' });
    ['about', 'staff', 'pricing', 'notice', 'sessions'].forEach(id => { const el = root.querySelector('#' + id); if (el) navIO.observe(el) })
    return () => { io.disconnect(); navIO.disconnect() }
  }, [loading])

  // 我在所選場次的預約狀態(用於 modal 顯示已報/可取消)+ 既有 profile(暱稱/頭像來源)
  useEffect(() => {
    let alive = true
    if (!sel || !user) { setSelBooking(null); setMyProfile(null); return }
    supabase.from('bookings').select('id, status').eq('session_id', sel.id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (alive) setSelBooking(data ?? null) })
    // 來源 = 既有 profile;兩者皆有 → 直接沿用,缺任一 → modal 內補填(預填既有值)
    supabase.from('profiles').select('game_name, avatar_url').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setMyProfile(data ?? null)
        setBkName(data?.game_name ?? '')
        setBkAvatar(data?.avatar_url ?? '')
      })
    return () => { alive = false }
  }, [sel, user])

  // 指名互動場:載入本場每位可指名獄卒的時格(含是否已被搶);依獄卒分組(SECURITY DEFINER RPC,匿名亦可叫)
  const loadNamedSlots = useCallback(async (sessionId) => {
    const { data } = await supabase.rpc('session_named_slots', { p_session: sessionId })
    const byG = new Map()
    for (const r of data ?? []) {
      if (!byG.has(r.guard_id)) byG.set(r.guard_id, { guard_id: r.guard_id, name: r.game_name || r.display_name || '獄卒', avatar: r.avatar_url || '', offersPolaroid: r.offers_polaroid !== false, portraitOnly: !!r.portrait_only, slots: [] })
      // crunch:slot_index 為 null(監督,無時格);named:帶時格 index/label
      byG.get(r.guard_id).slots.push({ index: r.slot_index, label: r.slot_label ?? (r.slot_index != null ? `第 ${r.slot_index + 1} 節` : null), taken: r.taken })
    }
    setNamedGuards([...byG.values()])
  }, [])
  useEffect(() => {
    if (sel && (sel.kind === 'named' || sel.kind === 'crunch')) loadNamedSlots(sel.id)
    else setNamedGuards([])
  }, [sel, loadNamedSlots])

  // 深連結:OAuth 登入後導回 /?intake=<id>,自動開該場 modal
  useEffect(() => {
    if (loading) return
    const id = new URLSearchParams(window.location.search).get('intake')
    if (id) { const s = sessions.find(x => x.id === id); if (s) setSel(s) }
  }, [loading, sessions])

  const scrollTo = id => rootRef.current?.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth' })
  const resetModalAuth = () => {
    setMPw(''); setMAuthBusy(false); setMAuthErr(null)
    setGName(''); setGPw(''); setGBusy(false); setGErr(null)
  }
  const resetPicks = () => { setReqSel(new Set()); setAddonsByGuard({}); setCapture({ on: false, client: '', target: '', guards: 2 }) }
  const openModal = s => { setSel(s); setMsg(null); setPw(''); setPwOk(false); setPwErr(null); resetPicks(); resetModalAuth() }
  const closeModal = () => { setSel(null); setMsg(null); setPw(''); setPwOk(false); setPwErr(null); resetPicks(); setNamedGuards([]); resetModalAuth() }

  // 由目前選擇組出送出用的 payload:指名(多筆)/每卒加購/抓捕訂單
  const buildPicks = () => {
    const requested_slots = [...reqSel].map(k => { const [g, s] = k.split('|'); return { g, s: s === '' ? null : Number(s) } })
    const addons = Object.entries(addonsByGuard)
      .map(([g, a]) => ({ g, polaroid: a?.polaroid || 0, sign: !!a?.sign, portrait: a?.portrait || 0 }))
      .filter(a => a.polaroid > 0 || a.portrait > 0)
    const cap = (sel?.kind === 'crunch' && capture.on && (capture.client.trim() || capture.target.trim()))
      ? { client: capture.client.trim(), target: capture.target.trim(), guards: Math.max(2, capture.guards || 2) } : null
    return { requested_slots, addons, capture: cap }
  }
  // 指名/監督多選 toggle;每卒加購數量設定(0..99)
  const toggleSel = (key) => setReqSel(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const setPolaroid = (gid, v) => setAddonsByGuard(prev => {
    const cur = prev[gid] || { polaroid: 0, sign: false, portrait: 0 }
    const nv = Math.max(0, Math.min(99, Number.isFinite(+v) ? Math.floor(+v) : 0))
    return { ...prev, [gid]: { ...cur, polaroid: nv } }
  })
  const setSign = (gid, val) => setAddonsByGuard(prev => {
    const cur = prev[gid] || { polaroid: 0, sign: false, portrait: 0 }
    return { ...prev, [gid]: { ...cur, sign: !!val } }
  })
  const setPortrait = (gid, v) => setAddonsByGuard(prev => {
    const cur = prev[gid] || { polaroid: 0, sign: false, portrait: 0 }
    const nv = Math.max(0, Math.min(99, Number.isFinite(+v) ? Math.floor(+v) : 0))
    return { ...prev, [gid]: { ...cur, portrait: nv } }
  })
  // 即時報價(萬):依場次類型 + 指名/監督數 + 每卒加購;抓捕由委託人付,另列不計入本人總額
  const priceSummary = () => {
    const picks = buildPicks()
    const lines = []; let total = 0
    const add = (lbl, det, amt) => { lines.push([lbl, det, amt]); total += amt }
    if (sel?.kind === 'named') {
      const slots = picks.requested_slots.filter(x => x.s !== null).length
      if (slots > 0) add('指名費', `15 × ${slots}`, PRICE.namedSlot * slots)
      else add('無指名入場', '', PRICE.namedEntry)
    } else if (sel?.kind === 'crunch') {
      add('入場費', '', PRICE.crunchEntry)
      const sup = picks.requested_slots.length
      if (sup > 0) add('指定監督', `10 × ${sup}`, PRICE.supervise * sup)
    }
    const pol = picks.addons.reduce((s, a) => s + a.polaroid, 0)
    const sgn = picks.addons.reduce((s, a) => s + (a.sign ? a.polaroid : 0), 0)
    const por = picks.addons.reduce((s, a) => s + (a.portrait || 0), 0)
    if (pol > 0) add('拍立得（空白）', `5 × ${pol}`, PRICE.polaroid * pol)
    if (sgn > 0) add('拍立得加購簽繪', `3 × ${sgn}`, PRICE.signAdd * sgn)
    if (por > 0) add('肖像畫', `80 × ${por}`, PRICE.portrait * por)
    return { lines, total, capture: picks.capture }
  }

  // modal 內帳號登入:成功後不換頁,直接刷新 user / 資料,留在同一個 modal 繼續報名流程。
  // 僅收帳號名(信箱登入已移除),後綴由程式補。
  async function modalEmailSignIn(e) {
    e.preventDefault()
    setMAuthErr(null)
    const raw = mEmail.trim()
    if (!raw || !mPw) { setMAuthErr('請輸入帳號與密碼'); return }
    if (raw.includes('@')) { setMAuthErr('請輸入帳號名（不含 @）；原以信箱註冊者請聯繫典獄長換發帳號'); return }
    setMAuthBusy(true)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${raw.toLowerCase()}@${INTERNAL_ACCOUNT_DOMAIN}`,
      password: mPw,
    })
    setMAuthBusy(false)
    if (error) { setMAuthErr(zhAuthError(error.message)); return }
    setUser(data.user)
    loadData()
  }

  // 不註冊預約:免登入送出,只記錄遊戲暱稱(無帳號、無法登入系統、無法自行取消)。
  // 密鑰場的通行密鑰直接在表單內填,由 /api/booking-guest 伺服器端核對。
  async function submitGuestBooking(e) {
    e.preventDefault()
    setGErr(null)
    const name = gName.trim()
    if (!name) { setGErr('請輸入遊戲暱稱'); return }
    if (!gServer.trim()) { setGErr('請輸入伺服器'); return }
    if (sel.hasPassword && !gPw.trim()) { setGErr('本梯次為密鑰場，請輸入通行密鑰'); return }
    setGBusy(true)
    const r = await createGuestBooking(sel.id, { game_name: name, server: gServer.trim(), password: sel.hasPassword ? gPw.trim() : null, ...buildPicks() })
    setGBusy(false)
    if (r.ok) {
      setMsg('收監成功。鈴響時見。（不註冊預約如需取消，請至 Discord 聯繫典獄長）')
      loadData()
      return
    }
    if (r.error === 'already_booked') setGErr('此暱稱已在此梯次服刑名冊上。')
    else if (r.error === 'full') setGErr('此梯次已停止收監。')
    else if (r.error === 'wrong_password') setGErr('通行密鑰不正確，請確認後重試。')
    else if (r.error === 'slot_taken') { setGErr('有指名時段/監督剛被別人選走了，請重新選擇。'); setReqSel(new Set()); loadNamedSlots(sel.id) }
    else if (r.error === 'guard_not_nameable') setGErr('指名的獄卒/時段已不開放,請重新選擇。')
    else setGErr('收監失敗，請稍後再試。')
  }

  // 密鑰場:報名前先核對通行密鑰(RPC 只回對/錯,不外洩密鑰;送出報名時 /api/booking 會再驗一次)
  async function verifyPassword() {
    const input = pw.trim()
    if (!input) return
    setPwChecking(true); setPwErr(null)
    const { data, error } = await supabase.rpc('check_session_password', { p_session: sel.id, p_password: input })
    setPwChecking(false)
    if (error) { setPwErr('密鑰核對失敗，請稍後再試。'); return }
    if (!data) { setPwErr('密鑰不正確，請確認後重試。'); return }
    setPwOk(true)
  }

  async function confirmBooking() {
    setSubmitting(true); setMsg(null)
    // 先確保此登入者有 profile(沒有就建檔發號;已有則補上空的暱稱/頭像)。
    // 帶入 modal 內填的暱稱/頭像;失敗不阻擋預約(profile 之後進 /app 也會自動建)。
    await supabase.rpc('claim_profile', {
      p_game_name: bkName.trim() || null,
      p_avatar_url: bkAvatar || null,
    })
    // 暱稱/頭像僅作該筆預約展示值(伺服器仍以 JWT 驗身分);沿用既有 profile 值或 modal 補填的值
    const r = await createBooking(sel.id, {
      game_name: bkName.trim() || null, avatar_url: bkAvatar || null,
      password: sel.hasPassword ? pw.trim() : null,
      ...buildPicks(),
    })
    setSubmitting(false)
    if (r.ok) setMsg('收監成功。鈴響時見。')
    else if (r.error === 'already_booked') setMsg('你已在此梯次服刑名冊上。')
    else if (r.error === 'full') setMsg('此梯次已停止收監。')
    else if (r.error === 'wrong_password') setMsg('通行密鑰不正確，請重新開啟報名並輸入密鑰。')
    else if (r.error === 'not_authenticated') setMsg('請先登入。')
    else if (r.error === 'slot_taken') setMsg('這個時段剛被別人選走了，請改選其他時段。')
    else if (r.error === 'guard_not_nameable') setMsg('指名的獄卒/時段已不開放,請重新選擇。')
    else setMsg('收監失敗，請稍後再試。')
    loadData()
    if (user) {
      const { data } = await supabase.from('bookings').select('id, status').eq('session_id', sel.id).eq('user_id', user.id).maybeSingle()
      setSelBooking(data ?? null)
    }
  }

  async function cancel() {
    if (!window.confirm('確定取消本梯次預約？')) return
    setSubmitting(true)
    const r = await cancelBooking(selBooking.id)
    setSubmitting(false)
    setMsg(r.ok ? '已取消預約。' : '取消失敗，請稍後再試。')
    setSelBooking(r.ok ? { ...selBooking, status: 'cancelled' } : selBooking)
    loadData()
  }

  async function rebook() {
    if (sel.capacity > 0 && sel.booked >= sel.capacity) { setMsg('此梯次已停止收監。'); return }
    setSubmitting(true)
    const patch = { status: 'pending' }
    if (sel.kind === 'named' || sel.kind === 'crunch') {   // 重新報名一併更新指名(多筆)/每卒加購/抓捕
      const picks = buildPicks()
      patch.requested_slots = picks.requested_slots
      patch.addons = picks.addons
      patch.capture = picks.capture
    }
    const { error } = await supabase.from('bookings').update(patch).eq('id', selBooking.id)
    setSubmitting(false)
    setMsg(error ? '重新報名失敗，請稍後再試。' : '已重新登記入監名冊。')
    setSelBooking(error ? selBooking : { ...selBooking, status: 'pending' })
    loadData()
  }

  const active = selBooking && selBooking.status !== 'cancelled'

  return (
    <div className="dp-site" ref={rootRef}>
      <div className="wrap">
        {/* 導覽列 */}
        <nav>
          <a className="brand" onClick={() => scrollTo('top')}>死線<b>監獄</b></a>
          <div className="links">
            <a data-sec="about" onClick={() => scrollTo('about')}>服刑須知</a>
            <a data-sec="staff" onClick={() => scrollTo('staff')}>監獄人員</a>
            <a data-sec="pricing" onClick={() => scrollTo('pricing')}>營業項目</a>
            <a data-sec="notice" onClick={() => scrollTo('notice')}>預約須知</a>
            <a data-sec="guide" onClick={() => scrollTo('guide')}>系統教學</a>
            <a data-sec="sessions" onClick={() => scrollTo('sessions')}>趕稿場次</a>
          </div>
          <div className="nav-entries">
            {SHOW_APP_ACCESS && <a className="nav-access" href="/app">ACCESS · 監獄系統</a>}
            <a className="nav-dc" href="https://discord.gg/tpRn7En9mk" target="_blank" rel="noopener noreferrer" aria-label="Discord">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.3 1.4 16.6 16.6 0 0 0-14.9 0A18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.4.3 17.8A20 20 0 0 0 6.4 21l.5-1.8a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1L17 21a20 20 0 0 0 6-3.2c.3-5.1-.5-9.4-2.7-13.4ZM8.4 15.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm7.2 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
              </svg>
            </a>
          </div>
          {/* 手機版漢堡按鈕(僅 720px 以下顯示) */}
          <button
            className="nav-burger"
            aria-label="選單"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menuOpen
                ? <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>
                : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
            </svg>
          </button>
        </nav>
        {/* 手機版下拉面板:展開時全寬列出區段連結 */}
        {menuOpen && (
          <div className="nav-drawer">
            {[
              ['about', '服刑須知'], ['staff', '監獄人員'],
              ['pricing', '營業項目'], ['notice', '預約須知'], ['guide', '系統教學'], ['sessions', '趕稿場次'],
            ].map(([id, label]) => (
              <a key={id} onClick={() => { scrollTo(id); setMenuOpen(false) }}>{label}</a>
            ))}
          </div>
        )}
        <div className="hazard thin" />

        {/* 首頁 */}
        <header className="hero" id="top">
          <div className="intake"><span className="dot" />收容中 · INTAKE OPEN · 24H</div>
          <h1>死線<span className="glow">監獄</span></h1>
          <div className="ensign">DEADLINE PRISON · NO.<span className="no">0118</span></div>
          <p className="tag">死線之前，<b>人人平等</b>。<br />你選擇祈求奇蹟發生，還是讓我們鞭策你？</p>
          <div className="crime" role="group" aria-label="拘留登記">
            <span><em>罪名</em><b>慣性拖稿</b></span>
            <span><em>刑期</em><b>一個番茄鐘起</b></span>
            <span><em>保釋</em><b>不受理</b></span>
          </div>
          <div className="hero-cta">
            <button className="cta-main" onClick={() => scrollTo('sessions')}>入監服刑 ▸</button>
          </div>
          <div className="scroll-hint">▼ 向下了解服刑流程</div>
        </header>

        <div className="hazard" />

        {/* 監獄介紹 */}
        <section id="about">
          <div className="eyebrow reveal">服刑須知 <span className="blk">// BLOCK 01</span></div>
          <h2 className="title reveal">挖坑一時爽，<br />一直挖坑一直爽。</h2>
          <p className="subline reveal">人總要為自己的挖坑負責任。死線監獄是一間以「番茄鐘」執行的趕稿收容所。入獄後定時休息，互相督促，並由帥氣的獄卒鼓勵你趕稿，也有其他犯人和你努力，你能感受到積極向上的力量！不論糖果或者鞭子，只要能達到目標，獄卒們都不會吝嗇給予。</p>
          <p className="place reveal">服刑地點：<b>巴哈姆特 - 薰衣草苗園 - 1區 - 18號</b></p>
          {/* 場次營運類型輪播:每場只有一種屬性(非一場多種) */}
          <h3 className="serving-title reveal">場次營運類型</h3>
          <p className="subline reveal" style={{ marginBottom: 20 }}>每一場只會是<b>其中一種</b>玩法——不是同一場混合多種，而是<b>不同梯次屬性不同</b>。入監前先認識這三種場次（下方自動輪播，可左右切換）。</p>
          <ServingTypesCarousel types={SERVING_TYPES} />
        </section>

        <div className="perforation" />

        {/* 監獄人員 */}
        <section id="staff">
          <div className="eyebrow reveal">獄方名冊 <span className="blk">// BLOCK 02</span></div>
          <h2 className="title reveal">監獄人員</h2>
          <p className="subline reveal">看守這座監獄、確保沒人逃稿的人。</p>
          <div className="roster reveal">
            {staff.length === 0 ? <p style={{ color: 'var(--dim)' }}>名冊整備中…</p> : staff.map((p, i) => (
              <div className="card" key={i}>
                <div className="mug">
                  {p.img ? <img src={p.img} alt={p.role} /> : <div className="initial">{p.role[0] || '?'}</div>}
                </div>
                <div className="body">
                  <div className="role">{p.role}</div>
                  <h4>{p.name}</h4>
                  <p className="bio">{p.bio || '〔機密資料未公開〕'}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="hazard" />

        {/* 營業項目:三種場次類型(類型 / 介紹 / 品項);收費價目併入此區 */}
        <section id="pricing">
          <div className="eyebrow reveal">營業項目 <span className="blk">// BLOCK 03</span></div>
          <h2 className="title reveal">各項收費</h2>
          <p className="subline reveal">依你的趕稿需求，選一種入監方式。三種場次的類型、介紹與品項如下；所有互動皆為角色扮演，請保持良好的 RP 禮儀。</p>
          <div className="stype-grid reveal">
            {SESSION_TYPES.map(t => (
              <div className="stype-card" key={t.code}>
                <div className="stype-head">
                  <span className="stype-code">{t.code}</span>
                  <div className="stype-name"><h4>{t.kind}</h4><span>{t.tagline}</span></div>
                </div>
                <div className="stype-seclbl">場次介紹 <span className="stype-en">// INTRO</span></div>
                <p className="stype-intro">{t.intro}</p>
                <div className="stype-seclbl items">場次品項 <span className="stype-en">// ITEMS</span></div>
                <ul className="stype-items">
                  {t.items.map((it, i) => (
                    <li key={i}>
                      <div className="it-main">
                        <span className="it-name">{it.n}</span>
                        <span className={`it-price${it.hot ? ' hot' : ''}${it.p === '免費' ? ' free' : ''}`}>
                          {it.was && <s className="it-was">{it.was}</s>}<b>{it.p}</b>{it.u && <em>{it.u}</em>}
                        </span>
                      </div>
                      {it.note && <div className="it-note">{it.note}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <div className="perforation" />

        {/* 預約須知(集體趕稿與指名場皆適用) */}
        <section id="notice">
          <div className="eyebrow reveal">預約須知 <span className="blk">// BLOCK 04</span></div>
          <h2 className="title reveal">服刑前須知</h2>
          <p className="subline reveal">報名場次前，請先詳閱以下須知。</p>
          <div className="notice reveal">
            {BOOKING_NOTICE.map(([no, title, body, link]) => (
              <div className="notice-item" key={no}>
                <div className="notice-no">{no}</div>
                <div className="notice-body">
                  <h3>{title}</h3>
                  <p>{body}</p>
                  {link && <a className="notice-dc" href={link} target="_blank" rel="noopener noreferrer">加入官方 Discord ↗</a>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="perforation" />

        {/* 後台系統教學(犯人視角):報名到服刑流程 */}
        <section id="guide">
          <div className="eyebrow reveal">後台系統教學 <span className="blk">// SYSTEM GUIDE</span></div>
          <h2 className="title reveal">怎麼服刑</h2>
          <p className="subline reveal">從報名到服刑,四步驟帶你認識死線監獄後台系統。</p>
          <div className="notice reveal">
            {SITE_INMATE_GUIDE.map(s => (
              <div className="notice-item" key={s.n}>
                <div className="notice-no">{s.n}</div>
                <div className="notice-body"><h3>{s.title}</h3><p>{s.body}</p></div>
              </div>
            ))}
          </div>
        </section>

        <div className="perforation" />

        {/* 趕稿場次 */}
        <section id="sessions">
          <div className="eyebrow reveal">服刑梯次 <span className="blk">// BLOCK 05</span></div>
          <h2 className="title reveal">近期趕稿場次</h2>
          <p className="subline reveal">選一個梯次自首入監。額滿停止收監，過期梯次已結案。</p>
          <div className="sessions reveal">
            {loading ? <p style={{ color: 'var(--dim)' }}>調閱梯次中…</p>
              : sessions.length === 0 ? <p style={{ color: 'var(--dim)' }}>目前沒有開放收監的梯次</p>
                : sessions.map(s => {
                  const meta = SESS_STATUS[s.displayStatus] ?? SESS_STATUS.booking
                  const { dd, mm } = splitDate(s.dateISO)
                  // capacity 為 null → 不限人數(永不額滿);有值才算額滿與顯示 /總額
                  const limited = s.capacity != null
                  const full = limited && s.booked >= s.capacity
                  const pct = limited && s.capacity > 0 ? Math.min(100, Math.round(s.booked / s.capacity * 100)) : 0
                  const capTxt = limited ? `已報名 ${s.booked} / ${s.capacity}` : `已報名 ${s.booked} 人`
                  const bookable = s.canBook && !full   // 可預約 = can_book 且未額滿
                  return (
                    <div className={`sess ${meta.cls}`} key={s.id}>
                      <div className="when"><div className="d">{dd}</div><div className="m">{mm}</div></div>
                      <div className="meta">
                        <div className="batch">{s.batch}<span className="sess-kind">{sessionKindLabel(s.kind)}</span></div>
                        <h4>{s.title}</h4>
                        <div className="cap">{capTxt}{limited && <span className="gauge"><i style={{ width: `${pct}%` }} /></span>}</div>
                      </div>
                      <div className="act">
                        <span className={`tag-status ${meta.cls}`}>{meta.label}</span>
                        {bookable
                          // 密鑰場顯示「密鑰入獄」,點開後需先通過密鑰核對才能報名
                          ? <button className="btn-book" onClick={() => openModal(s)}>{s.hasPassword ? '密鑰入獄' : '入監服刑'}</button>
                          // can_book 但額滿 → 已額滿;can_book=false → 顯示對應狀態文字(報名暫停/入場中/服刑中)
                          : <button className="btn-book" disabled>{s.canBook ? '已額滿' : meta.label}</button>}
                      </div>
                    </div>
                  )
                })}
          </div>
        </section>

        <div className="hazard" />
        <footer>
          <div className="f-brand">死線<b>監獄</b></div>
          <div className="f-sub">DEADLINE PRISON · 趕稿收容所 · since 2026</div>
          <div className="f-addr">服刑地點：巴哈姆特 - 薰衣草苗園 - 1區 - 18號</div>
          <div className="f-stamp" aria-hidden="true">結案 · CLASSIFIED</div>
        </footer>
      </div>

      {/* 入監服刑 Modal */}
      {sel && (
        <div className="dp-modal-bg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="dp-modal">
            <div className="m-haz" />
            <button className="m-close" onClick={closeModal}>✕</button>
            <div className="m-body">
              <div className="m-eyebrow">{sel.hasPassword ? '密鑰入獄 · INTAKE' : '入監服刑 · INTAKE'}</div>
              <h3>{sel.title}</h3>
              <div className="m-row"><span>梯次編號</span><b>{sel.batch}</b></div>
              <div className="m-row"><span>場次類型</span><b>{sessionKindLabel(sel.kind)}</b></div>
              <div className="m-row"><span>服刑日期</span><b>{sel.dateISO || '未定'}</b></div>
              <div className="m-row"><span>收容情況</span><b>{sel.capacity > 0 ? `${sel.booked} / ${sel.capacity}` : `${sel.booked} ／ 不限`}</b></div>
              {/* 備註:有獄卒的場(集體/指名)說明休息時間可互動;自由入場無獄卒則說明無人服務 */}
              {sel.kind === 'free'
                ? <p className="m-remark">備註：此場次無獄卒、無工作人員服務。</p>
                : <p className="m-remark">備註：獄卒將會在休息時間處理公務，此時你可以與全場有空閒的獄卒互動。</p>}
              {/* DC 同步進場僅自由入場場開放(指名/趕稿場不顯示) */}
              {sel.kind === 'free' && (
                <p className="m-remark">本場為自由入場，DC 開放同步進場、典獄長直播大螢幕倒數，歡迎親朋好友探監，你不是一個人。</p>
              )}

              {/* 指名(named 帶時段可多選 / crunch 指定監督互斥)+ 每卒加購 + 抓捕 + 即時報價。
                  已被搶的時段/監督顯示不可點。已在名冊/報名完成後不再顯示。 */}
              {(sel.kind === 'named' || sel.kind === 'crunch') && !msg && !active && (
                <div className="m-namepick">
                  <div className="m-field-lbl">{sel.kind === 'crunch' ? '指定監督獄卒 · 每卒加購' : '指名獄卒 · 半小時時段 · 每卒加購'}</div>
                  {namedGuards.length === 0 ? (
                    <p className="m-note" style={{ margin: '4px 0 0' }}>本場暫未開放{sel.kind === 'crunch' ? '指定監督' : '指名'}，將由典獄長安排獄卒。</p>
                  ) : (<>
                    <button type="button" className={`m-none ${reqSel.size === 0 ? 'on' : ''}`} onClick={() => setReqSel(new Set())}>
                      不指定（由典獄長安排）
                    </button>
                    {namedGuards.map(g => {
                      const ad = addonsByGuard[g.guard_id] || { polaroid: 0, sign: false, portrait: 0 }
                      return (
                        <div className="m-guardrow" key={g.guard_id}>
                          <div className="m-guard-id">
                            {g.avatar
                              ? <img className="m-guard-av" src={g.avatar} alt="" />
                              : <span className="m-guard-av none">{g.name[0]}</span>}
                            <span className="m-guard-nm">{g.name}{g.portraitOnly ? ' · 肖像畫' : ''}</span>
                          </div>
                          <div className="m-guard-pick">
                            {g.portraitOnly ? (
                              <div className="m-addon-steps">
                                <div className="m-astep">
                                  <span className="m-astep-lbl">肖像畫</span>
                                  <button type="button" className="m-step-btn" disabled={ad.portrait <= 0} onClick={() => setPortrait(g.guard_id, ad.portrait - 1)}>−</button>
                                  <input className="m-step-num" type="number" min="0" max="99" value={ad.portrait}
                                    onChange={e => setPortrait(g.guard_id, e.target.value)} onFocus={e => e.target.select()} />
                                  <button type="button" className="m-step-btn" onClick={() => setPortrait(g.guard_id, ad.portrait + 1)}>＋</button>
                                </div>
                                <span className="m-sign-txt">80 萬／張・限本卒繪製（不接指名／拍立得／監督）</span>
                              </div>
                            ) : (<>
                            <div className="m-slots">
                              {sel.kind === 'crunch' ? (() => {
                                const s0 = g.slots[0] || { taken: false }
                                const key = `${g.guard_id}|`
                                const on = reqSel.has(key)
                                return (
                                  <button type="button" disabled={s0.taken && !on}
                                    className={`m-slot ${on ? 'on' : ''} ${s0.taken ? 'taken' : ''}`}
                                    onClick={() => toggleSel(key)}>
                                    指定監督{s0.taken ? '·已被指定' : ''}
                                  </button>
                                )
                              })() : (
                                g.slots.length === 0 ? <span className="m-slot-empty">無開放時段</span>
                                  : g.slots.map(s => {
                                    const key = `${g.guard_id}|${s.index}`
                                    const on = reqSel.has(key)
                                    return (
                                      <button type="button" key={s.index} disabled={s.taken && !on}
                                        className={`m-slot ${on ? 'on' : ''} ${s.taken ? 'taken' : ''}`}
                                        onClick={() => toggleSel(key)}>
                                        {s.label}{s.taken ? '·已滿' : ''}
                                      </button>
                                    )
                                  })
                              )}
                            </div>
                            {g.offersPolaroid ? (
                              <div className="m-addon-steps">
                                <div className="m-astep">
                                  <span className="m-astep-lbl">拍立得</span>
                                  <button type="button" className="m-step-btn" disabled={ad.polaroid <= 0} onClick={() => setPolaroid(g.guard_id, ad.polaroid - 1)}>−</button>
                                  <input className="m-step-num" type="number" min="0" max="99" value={ad.polaroid}
                                    onChange={e => setPolaroid(g.guard_id, e.target.value)} onFocus={e => e.target.select()} />
                                  <button type="button" className="m-step-btn" onClick={() => setPolaroid(g.guard_id, ad.polaroid + 1)}>＋</button>
                                </div>
                                <label className="m-astep m-sign">
                                  <span className="m-astep-lbl">簽繪</span>
                                  <input type="checkbox" checked={!!ad.sign} disabled={ad.polaroid <= 0} onChange={e => setSign(g.guard_id, e.target.checked)} />
                                  <span className="m-sign-txt">全部加購簽繪（每張 +3）</span>
                                </label>
                              </div>
                            ) : (
                              <span className="m-slot-empty">本獄卒不提供拍立得加購</span>
                            )}
                            </>)}
                          </div>
                        </div>
                      )
                    })}
                  </>)}

                  {/* 集體趕稿場:我要把朋友抓進去(監獄外抓捕) */}
                  {sel.kind === 'crunch' && (
                    <div className="m-capture">
                      <label className="m-addon-row">
                        <input type="checkbox" checked={capture.on} onChange={e => setCapture({ ...capture, on: e.target.checked })} />
                        <span>我要把朋友抓進去（監獄外抓捕）</span>
                      </label>
                      {capture.on && (
                        <div className="m-capture-fields">
                          <div className="m-field"><span className="m-field-lbl">委託人暱稱</span>
                            <input className="m-input" placeholder="暱稱＠伺服器" value={capture.client} onChange={e => setCapture({ ...capture, client: e.target.value })} /></div>
                          <div className="m-field"><span className="m-field-lbl">犯人暱稱</span>
                            <input className="m-input" placeholder="暱稱＠伺服器" value={capture.target} onChange={e => setCapture({ ...capture, target: e.target.value })} /></div>
                          <div className="m-field">
                            <span className="m-field-lbl">抓捕獄卒人數</span>
                            <div className="m-astep" style={{ paddingTop: 4 }}>
                              <button type="button" className="m-step-btn" disabled={capture.guards <= 2} onClick={() => setCapture({ ...capture, guards: Math.max(2, (capture.guards || 2) - 1) })}>−</button>
                              <input className="m-step-num" type="number" min="2" max={Math.max(2, namedGuards.length)} value={capture.guards}
                                onChange={e => setCapture({ ...capture, guards: Math.max(2, Math.min(Math.max(2, namedGuards.length), parseInt(e.target.value) || 2)) })} onFocus={e => e.target.select()} />
                              <button type="button" className="m-step-btn" disabled={capture.guards >= Math.max(2, namedGuards.length)} onClick={() => setCapture({ ...capture, guards: Math.min(Math.max(2, namedGuards.length), (capture.guards || 2) + 1) })}>＋</button>
                              <span className="m-sign-txt">最少 2、最多 {Math.max(2, namedGuards.length)}（當日上班）</span>
                            </div>
                          </div>
                          <p className="m-note">1. 無法指定抓捕負責獄卒。2. 可選擇抓捕獄卒總人數（最少 2、最多當日上班人數）。委託人為主要聯絡人，需要加入 DC 並與典獄長預約先行繳交費用。</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 即時預估總額 */}
                  {(() => {
                    const sum = priceSummary()
                    return (
                      <div className="m-total">
                        {sum.lines.map(([lbl, det, amt], i) => (
                          <div className="m-total-row" key={i}><span>{lbl}{det ? ` · ${det}` : ''}</span><b>{amt} 萬</b></div>
                        ))}
                        {sum.capture && <div className="m-total-row"><span>監獄外抓捕 · {sum.capture.guards} 位（委託人另付）</span><b>{PRICE.captureBase + PRICE.captureAdd * (sum.capture.guards - 2)} 萬起</b></div>}
                        <div className="m-total-row sum"><span>預估總額</span><b>{sum.total} 萬</b></div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {msg ? (
                <p className="m-note" style={{ color: 'var(--text)' }}>{msg}</p>
              ) : user === null ? (
                <>
                  {/* 先顯示:不登入直接預約(暱稱 + 伺服器兩欄) */}
                  <p className="m-note">不登入直接預約：名冊記錄你的<b style={{ color: 'var(--text)' }}>暱稱與伺服器</b>；同暱稱+伺服器會累積到同一份犯人資料。如需取消請至 Discord 聯繫典獄長。</p>
                  <form onSubmit={submitGuestBooking}>
                    <div className="m-field-row" style={{ display: 'flex', gap: 10 }}>
                      <div className="m-field" style={{ flex: 1 }}>
                        <span className="m-field-lbl">暱稱</span>
                        <input className="m-input" type="text" maxLength={60} placeholder="遊戲角色暱稱"
                          value={gName} onChange={e => setGName(e.target.value)} />
                      </div>
                      <div className="m-field" style={{ flex: 1 }}>
                        <span className="m-field-lbl">伺服器</span>
                        <input className="m-input" type="text" maxLength={60} placeholder="所在伺服器"
                          value={gServer} onChange={e => setGServer(e.target.value)} />
                      </div>
                    </div>
                    {sel.hasPassword && (
                      <div className="m-field">
                        <span className="m-field-lbl">通行密鑰</span>
                        <input className="m-input" type="password" placeholder="本梯次為密鑰場"
                          value={gPw} onChange={e => setGPw(e.target.value)} />
                      </div>
                    )}
                    {gErr && <p className="m-note" style={{ color: 'var(--alarm)', margin: '10px 0' }}>{gErr}</p>}
                    <button className="m-dc m-confirm" type="submit" disabled={gBusy}>
                      {gBusy ? '收監中…' : '確認入監（不註冊）'}
                    </button>
                  </form>

                  <div className="m-or"><span /><em>或</em><span /></div>

                  {/* 後顯示:帳號密碼登入報名 */}
                  <p className="m-note">登入報名：請以<b style={{ color: 'var(--text)' }}>帳號密碼</b>登入；尚無帳密請向典獄長索取。</p>
                  <form onSubmit={modalEmailSignIn}>
                    <div className="m-field">
                      <span className="m-field-lbl">帳號</span>
                      <input className="m-input" type="text" autoComplete="username" placeholder="帳號"
                        value={mEmail} onChange={e => setMEmail(e.target.value)} />
                    </div>
                    <div className="m-field">
                      <span className="m-field-lbl">密碼</span>
                      <input className="m-input" type="password" autoComplete="current-password" placeholder="密碼"
                        value={mPw} onChange={e => setMPw(e.target.value)} />
                    </div>
                    {mAuthErr && <p className="m-note" style={{ color: 'var(--alarm)', margin: '10px 0' }}>{mAuthErr}</p>}
                    <button className="m-dc m-confirm" type="submit" disabled={mAuthBusy}>
                      {mAuthBusy ? '登入中…' : '登入'}
                    </button>
                  </form>
                  <p className="m-choose">本系統不開放自行註冊，請向典獄長索取帳號密碼。</p>
                </>
              ) : active ? (
                <>
                  <p className="m-note">你已在此梯次服刑名冊上。</p>
                  <button className="m-dc m-ghost" onClick={cancel} disabled={submitting}>取消預約</button>
                </>
              ) : (sel.hasPassword && !pwOk) ? (
                // 密鑰場關卡:通過核對才進入報名流程(已在名冊上的取消不需密鑰)
                <>
                  <p className="m-note">本梯次為<b style={{ color: 'var(--text)' }}>密鑰場</b>，請輸入通行密鑰後繼續報名。</p>
                  <div className="m-field">
                    <span className="m-field-lbl">通行密鑰</span>
                    <input className="m-input" type="password" placeholder="輸入通行密鑰" value={pw}
                      onChange={e => setPw(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') verifyPassword() }} />
                  </div>
                  {pwErr && <p className="m-note" style={{ color: 'var(--alarm)' }}>{pwErr}</p>}
                  <button className="m-dc m-confirm" onClick={verifyPassword} disabled={pwChecking || !pw.trim()}>
                    {pwChecking ? '核對中…' : '核對密鑰'}
                  </button>
                </>
              ) : selBooking ? (
                <>
                  <p className="m-note">你先前已取消此梯次。要重新登記入監名冊嗎？</p>
                  <button className="m-dc m-confirm" onClick={rebook} disabled={submitting}>{submitting ? '處理中…' : '重新報名'}</button>
                </>
              ) : (myProfile?.game_name && myProfile?.avatar_url) ? (
                // 既有 profile 暱稱/頭像皆有 → 直接以該身分入監,沿用既有值
                <>
                  <div className="m-intake-id">
                    {myProfile.avatar_url && <img className="m-intake-av" src={myProfile.avatar_url} alt="" />}
                    <p className="m-note" style={{ margin: 0 }}>以 <b style={{ color: 'var(--text)' }}>{myProfile.game_name}</b> 身分入監，確認後登入服刑名冊。</p>
                  </div>
                  <button className="m-dc m-confirm" onClick={confirmBooking} disabled={submitting}>{submitting ? '收監中…' : '確認入監'}</button>
                </>
              ) : (
                // 缺暱稱或頭像 → modal 內補填(暱稱必填 + 頭像上傳),填妥才能確認入監
                <>
                  <p className="m-note">入監前請設定你的<b style={{ color: 'var(--text)' }}>服刑暱稱與頭像</b>（將作為本梯次名冊的顯示資料）。</p>
                  <div className="m-field">
                    <span className="m-field-lbl">服刑暱稱（必填）</span>
                    <input className="m-input" placeholder="暱稱＠伺服器" value={bkName} onChange={e => setBkName(e.target.value)} />
                  </div>
                  <div className="m-field">
                    <span className="m-field-lbl">頭像</span>
                    <AvatarInput value={bkAvatar} onChange={url => setBkAvatar(url)} userId={user.id} />
                  </div>
                  <button className="m-dc m-confirm" onClick={confirmBooking} disabled={submitting || !bkName.trim() || !bkAvatar}>
                    {submitting ? '收監中…' : '確認入監'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
