import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { createBooking, cancelBooking } from '../bookingApi'
import { toSessionView, splitDate } from '../prison'
import AvatarInput from '../AvatarInput'
import './prison-site.css'

const RULES = [
  ['01', '入監上鎖', '選定梯次、以 Discord 登入入監。報到後鎖門，專注鈴響起，眾人同步服刑。'],
  ['02', '放風有時', '專注 25 分鐘、放風 5 分鐘為一輪；每四輪一次長休 15 分鐘。鈴聲統一，不得擅自離場。'],
  ['03', '全程直播', '典獄長控台同步大螢幕計時，犯人進度公開可見。被看著，就趕得動。'],
  ['04', '刑滿釋放', '梯次結束即收尾放人。帶著趕完的稿離開——或自首下一場。'],
]

// 場次狀態徽章(依 public_sessions 的 display_status;後端已過濾已結束場)
const SESS_STATUS = {
  booking:        { label: '預約中',   cls: 'booking' },  // 預約中(正向綠)
  booking_paused: { label: '報名暫停', cls: 'paused' },   // 報名暫停(中性灰)
  intake:         { label: '入場中',   cls: 'intake' },   // 入場中(中性灰)
  serving:        { label: '服刑中',   cls: 'serving' },  // 服刑中(強調色)
}

// 名人堂榜單圖示(取代 emoji ⛓/💌,維持工業線稿調性)
const ChainIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </svg>
)
const MailIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="1" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)

const DiscordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.3 1.4 16.6 16.6 0 0 0-14.9 0A18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.4.3 17.8A20 20 0 0 0 6.4 21l.5-1.8a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1L17 21a20 20 0 0 0 6-3.2c.3-5.1-.5-9.4-2.7-13.4ZM8.4 15.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm7.2 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
  </svg>
)

export default function PrisonSite() {
  const [sessions, setSessions] = useState([])
  const [staff, setStaff] = useState([])
  const [wall, setWall] = useState([])  // 犯人牆(願意公開服刑紀錄的犯人)
  const [crime, setCrime] = useState([])    // 名人堂 · 慣犯榜(入監次數 Top10)
  const [popular, setPopular] = useState([]) // 名人堂 · 人氣榜(收到探監 Top10)
  const [user, setUser] = useState(undefined)  // undefined=載入中, null=未登入
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)         // 開著的入監 modal 對應場次
  const [selBooking, setSelBooking] = useState(null) // 我在 sel 這場的預約(含 cancelled)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState(null)
  const [myProfile, setMyProfile] = useState(null)   // 預約者既有 profile(暱稱/頭像來源判定)
  const [bkName, setBkName] = useState('')           // 入監暱稱(預設帶既有 game_name)
  const [bkAvatar, setBkAvatar] = useState('')       // 入監頭像 URL(預設帶既有 avatar_url)
  const rootRef = useRef(null)

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    setUser(session?.user ?? null)
    const [{ data: sess }, { data: st }, { data: wl }, { data: crimeData }, { data: popData }] = await Promise.all([
      supabase.rpc('public_sessions'),
      supabase.rpc('public_staff'),
      supabase.rpc('public_wall'),
      supabase.rpc('leaderboard_visits_count'),
      supabase.rpc('leaderboard_popularity'),
    ])
    setCrime(crimeData ?? [])
    setPopular(popData ?? [])
    setSessions((sess ?? []).map(toSessionView))
    setStaff((st ?? []).map(r => ({
      role: r.role === 'warden' ? '典獄長' : '獄卒',
      name: r.game_name || r.display_name || '——',
      img: r.avatar_url || '',
      bio: r.bio || '',   // 真實 bio;空則由顯示端補 fallback
    })))
    setWall((wl ?? []).map(r => ({
      no: r.inmate_no,
      name: r.game_name || r.display_name || '——',
      img: r.avatar_url || '',
      bio: r.bio || '',
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
    root.querySelectorAll('.reveal').forEach(el => io.observe(el))
    const navIO = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        root.querySelectorAll('nav .links a').forEach(a =>
          a.classList.toggle('active', a.getAttribute('data-sec') === e.target.id))
      }
    }), { rootMargin: '-50% 0px -50% 0px' });
    ['about', 'staff', 'wall', 'hall', 'sessions'].forEach(id => { const el = root.querySelector('#' + id); if (el) navIO.observe(el) })
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

  // 深連結:OAuth 登入後導回 /?intake=<id>,自動開該場 modal
  useEffect(() => {
    if (loading) return
    const id = new URLSearchParams(window.location.search).get('intake')
    if (id) { const s = sessions.find(x => x.id === id); if (s) setSel(s) }
  }, [loading, sessions])

  const scrollTo = id => rootRef.current?.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth' })
  const openModal = s => { setSel(s); setMsg(null) }
  const closeModal = () => { setSel(null); setMsg(null) }

  async function loginWithDiscord() {
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${window.location.origin}/?intake=${sel.id}`, scopes: 'identify' },
    })
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
    const r = await createBooking(sel.id, { game_name: bkName.trim() || null, avatar_url: bkAvatar || null })
    setSubmitting(false)
    if (r.ok) setMsg('收監成功。鈴響時見。')
    else if (r.error === 'already_booked') setMsg('你已在此梯次服刑名冊上。')
    else if (r.error === 'full') setMsg('此梯次已停止收監。')
    else if (r.error === 'not_authenticated') setMsg('請先以 Discord 登入。')
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
    const { error } = await supabase.from('bookings').update({ status: 'pending' }).eq('id', selBooking.id)
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
            <a data-sec="wall" onClick={() => scrollTo('wall')}>犯人牆</a>
            <a data-sec="hall" onClick={() => scrollTo('hall')}>名人堂</a>
            <a data-sec="sessions" onClick={() => scrollTo('sessions')}>趕稿場次</a>
          </div>
          <div className="nav-entries">
            <a className="nav-access" href="/app">ACCESS · 監獄系統</a>
            <a className="nav-dc" href="https://discord.gg/tpRn7En9mk" target="_blank" rel="noopener noreferrer" aria-label="Discord">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.3 1.4 16.6 16.6 0 0 0-14.9 0A18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.4.3 17.8A20 20 0 0 0 6.4 21l.5-1.8a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1L17 21a20 20 0 0 0 6-3.2c.3-5.1-.5-9.4-2.7-13.4ZM8.4 15.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm7.2 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
              </svg>
            </a>
          </div>
        </nav>
        <div className="hazard thin" />

        {/* 首頁 */}
        <header className="hero" id="top">
          <div className="intake"><span className="dot" />收容中 · INTAKE OPEN · 24H</div>
          <h1>死線<span className="glow">監獄</span></h1>
          <div className="ensign">DEADLINE PRISON · NO.<span className="no">0118</span></div>
          <p className="tag">把自己關進來，<b>服完這一頁死線</b>。<br />沒有逃獄，只有交稿。</p>
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
          <h2 className="title reveal">這裡關的，<br />是趕不完稿的人</h2>
          <p className="subline reveal">死線監獄是一間以「番茄鐘」執行的趕稿收容所。入監即上鎖，鈴響才放風，全程同步直播犯人服刑進度——你不是一個人在趕，是一群人一起服刑。</p>
          <p className="place reveal">服刑地點：<b>巴哈姆特 - 薰衣草苗園 - 1區 - 18號</b></p>
          <div className="rules reveal">
            {RULES.map(([n, h, p]) => (
              <div className="rule" key={n}><span className="pin" /><div className="rn">{n}</div><h3>{h}</h3><p>{p}</p></div>
            ))}
          </div>
          <div className="rhythm reveal">
            <div className="lbl">服刑節奏 · POMODORO CYCLE</div>
            <div className="bars">
              <i className="focus" /><i className="rest" /><i className="focus" /><i className="rest" />
              <i className="focus" /><i className="rest" /><i className="focus" /><i className="long" />
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--hazard)' }} />專注 25 分</span>
              <span><i style={{ background: 'var(--steel)' }} />放風 5 分</span>
              <span><i style={{ background: 'var(--alarm)' }} />長休 15 分（每 4 輪）</span>
            </div>
          </div>
        </section>

        <div className="hazard" />

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

        {/* 犯人牆(自願公開服刑紀錄的犯人) */}
        <section id="wall">
          <div className="eyebrow reveal">服刑紀錄 <span className="blk">// BLOCK 03</span></div>
          <h2 className="title reveal">犯人牆</h2>
          <p className="subline reveal">自願把服刑紀錄公開示眾的犯人。沒被趕完的稿，大家一起看著。</p>
          <div className="roster reveal">
            {loading ? <p style={{ color: 'var(--dim)' }}>調閱服刑紀錄中…</p>
              : wall.length === 0 ? <p style={{ color: 'var(--dim)' }}>目前無人願意公開服刑紀錄</p>
                : wall.map((p, i) => (
                  <div className="card" key={i}>
                    <div className="mug">
                      {p.img ? <img src={p.img} alt={p.name} /> : <div className="initial">{p.name[0] || '?'}</div>}
                    </div>
                    <div className="body">
                      <div className="role">No.{String(p.no ?? 0).padStart(4, '0')}</div>
                      <h4>{p.name}</h4>
                      <p className="bio">{p.bio || '〔機密資料未公開〕'}</p>
                    </div>
                  </div>
                ))}
          </div>
        </section>

        <div className="hazard" />

        {/* 監獄名人堂(排行榜:慣犯榜 / 人氣榜) */}
        <section id="hall">
          <div className="eyebrow reveal">監獄名人堂 <span className="blk">// BLOCK 04</span></div>
          <h2 className="title reveal">名人堂</h2>
          <p className="subline reveal">服刑最勤、人氣最高的犯人。次數照實計入，名字是否公開由本人決定。</p>
          <div className="halls reveal">
            {[
              { key: 'crime', icon: ChainIcon, title: '慣犯榜', sub: '入監次數 TOP 10', rows: crime },
              { key: 'popular', icon: MailIcon, title: '人氣榜', sub: '收到探監 TOP 10', rows: popular },
            ].map(board => (
              <div className="hall-board" key={board.key}>
                <div className="hall-head">
                  <span className="hall-icon"><board.icon /></span>{board.title}
                  <span className="hall-sub">{board.sub}</span>
                </div>
                {loading ? <p className="hall-empty">名冊整備中…</p>
                  : board.rows.length === 0 ? <p className="hall-empty">名冊整備中…</p>
                    : (
                      <ol className="hall-list">
                        {board.rows.map(r => (
                          <li className={`hall-row${r.rank <= 3 ? ' top' : ''}`} key={r.rank}>
                            <span className="hall-rank">{r.rank}</span>
                            <span className={`hall-name${r.display_name ? '' : ' masked'}`}>
                              {r.display_name ?? '〔機密犯人〕'}
                            </span>
                            <span className="hall-count">{r.count} 次</span>
                          </li>
                        ))}
                      </ol>
                    )}
              </div>
            ))}
          </div>
        </section>

        <div className="hazard" />

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
                        <div className="batch">{s.batch}</div>
                        <h4>{s.title}</h4>
                        <div className="cap">{capTxt}{limited && <span className="gauge"><i style={{ width: `${pct}%` }} /></span>}</div>
                      </div>
                      <div className="act">
                        <span className={`tag-status ${meta.cls}`}>{meta.label}</span>
                        {bookable
                          ? <button className="btn-book" onClick={() => openModal(s)}>入監服刑</button>
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
        </footer>
      </div>

      {/* 入監服刑 Modal */}
      {sel && (
        <div className="dp-modal-bg" onClick={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="dp-modal">
            <div className="m-haz" />
            <button className="m-close" onClick={closeModal}>✕</button>
            <div className="m-body">
              <div className="m-eyebrow">入監服刑 · INTAKE</div>
              <h3>{sel.title}</h3>
              <div className="m-row"><span>梯次編號</span><b>{sel.batch}</b></div>
              <div className="m-row"><span>服刑日期</span><b>{sel.dateISO || '未定'}</b></div>
              <div className="m-row"><span>收容情況</span><b>{sel.capacity > 0 ? `${sel.booked} / ${sel.capacity}` : `${sel.booked} ／ 不限`}</b></div>

              {msg ? (
                <p className="m-note" style={{ color: 'var(--text)' }}>{msg}</p>
              ) : user === null ? (
                <>
                  <p className="m-note">入監採 <b style={{ color: 'var(--text)' }}>Discord 登入</b>，登入後自動帶入你的 DC 身分作為服刑名冊紀錄，無需另填聯絡方式。</p>
                  <button className="m-dc" onClick={loginWithDiscord}><DiscordIcon />以 Discord 登入入監</button>
                </>
              ) : active ? (
                <>
                  <p className="m-note">你已在此梯次服刑名冊上。</p>
                  <button className="m-dc m-ghost" onClick={cancel} disabled={submitting}>取消預約</button>
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
                    <input className="m-input" placeholder="顯示在名冊上的暱稱" value={bkName} onChange={e => setBkName(e.target.value)} />
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
