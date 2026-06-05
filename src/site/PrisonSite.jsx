import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { createBooking, cancelBooking } from '../bookingApi'
import { sessionStatus, toSessionView, splitDate } from '../prison'
import './prison-site.css'

const RULES = [
  ['01', '入監上鎖', '選定梯次、以 Discord 登入入監。報到後鎖門,專注鈴響起,眾人同步服刑。'],
  ['02', '放風有時', '專注 25 分鐘、放風 5 分鐘為一輪;每四輪一次長休 15 分鐘。鈴聲統一,不得擅自離場。'],
  ['03', '全程直播', '典獄長控台同步大螢幕計時,犯人進度公開可見。被看著,就趕得動。'],
  ['04', '刑滿釋放', '梯次結束即收尾放人。帶著趕完的稿離開——或自首下一場。'],
]

const DiscordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5a18 18 0 0 1 4.3 1.4 16.6 16.6 0 0 0-14.9 0A18 18 0 0 1 8.9 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 .1 13.4.3 17.8A20 20 0 0 0 6.4 21l.5-1.8a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1L17 21a20 20 0 0 0 6-3.2c.3-5.1-.5-9.4-2.7-13.4ZM8.4 15.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm7.2 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" />
  </svg>
)

export default function PrisonSite() {
  const [sessions, setSessions] = useState([])
  const [staff, setStaff] = useState([])
  const [user, setUser] = useState(undefined)  // undefined=載入中, null=未登入
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(null)         // 開著的入監 modal 對應場次
  const [selBooking, setSelBooking] = useState(null) // 我在 sel 這場的預約(含 cancelled)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState(null)
  const rootRef = useRef(null)

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    setUser(session?.user ?? null)
    const [{ data: sess }, { data: st }] = await Promise.all([
      supabase.rpc('public_sessions'),
      supabase.rpc('public_staff'),
    ])
    setSessions((sess ?? []).map(toSessionView))
    let w = 0, g = 0
    setStaff((st ?? []).map(r => {
      const isW = r.role === 'warden'
      const seq = isW ? ++w : ++g
      return {
        role: isW ? '典獄長' : '獄卒',
        name: r.game_name || r.display_name || '——',
        no: (isW ? 'W' : 'G') + '-' + String(seq).padStart(3, '0'),
        img: r.avatar_url || '',
        bio: isW ? '掌管全獄、開關場次與計時。逃稿者的最終裁決者。' : '巡場、報到、看守服刑秩序。鈴響時最不通融的人。',
      }
    }))
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
    ['about', 'staff', 'sessions'].forEach(id => { const el = root.querySelector('#' + id); if (el) navIO.observe(el) })
    return () => { io.disconnect(); navIO.disconnect() }
  }, [loading])

  // 我在所選場次的預約狀態(用於 modal 顯示已報/可取消)
  useEffect(() => {
    let alive = true
    if (!sel || !user) { setSelBooking(null); return }
    supabase.from('bookings').select('id, status').eq('session_id', sel.id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (alive) setSelBooking(data ?? null) })
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
      options: { redirectTo: `${window.location.origin}/?intake=${sel.id}` },
    })
  }

  async function confirmBooking() {
    setSubmitting(true); setMsg(null)
    const r = await createBooking(sel.id, null)
    setSubmitting(false)
    if (r.ok) setMsg('收監成功。鈴響時見。')
    else if (r.error === 'already_booked') setMsg('你已在此梯次服刑名冊上。')
    else if (r.error === 'full') setMsg('此梯次已停止收監。')
    else if (r.error === 'not_authenticated') setMsg('請先以 Discord 登入。')
    else setMsg('收監失敗,請稍後再試。')
    loadData()
    if (user) {
      const { data } = await supabase.from('bookings').select('id, status').eq('session_id', sel.id).eq('user_id', user.id).maybeSingle()
      setSelBooking(data ?? null)
    }
  }

  async function cancel() {
    if (!window.confirm('確定取消本梯次預約?')) return
    setSubmitting(true)
    const r = await cancelBooking(selBooking.id)
    setSubmitting(false)
    setMsg(r.ok ? '已取消預約。' : '取消失敗,請稍後再試。')
    setSelBooking(r.ok ? { ...selBooking, status: 'cancelled' } : selBooking)
    loadData()
  }

  async function rebook() {
    if (sel.capacity > 0 && sel.booked >= sel.capacity) { setMsg('此梯次已停止收監。'); return }
    setSubmitting(true)
    const { error } = await supabase.from('bookings').update({ status: 'pending' }).eq('id', selBooking.id)
    setSubmitting(false)
    setMsg(error ? '重新報名失敗,請稍後再試。' : '已重新登記入監名冊。')
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
            <a data-sec="about" onClick={() => scrollTo('about')}>監獄介紹</a>
            <a data-sec="staff" onClick={() => scrollTo('staff')}>監獄人員</a>
            <a data-sec="sessions" onClick={() => scrollTo('sessions')}>趕稿場次</a>
            <button className="btn-serve" onClick={() => scrollTo('sessions')}>入監服刑</button>
          </div>
        </nav>
        <div className="hazard thin" />

        {/* 首頁 */}
        <header className="hero" id="top">
          <div className="intake"><span className="dot" />收容中 · INTAKE OPEN · 24H</div>
          <h1>死線<span className="glow">監獄</span></h1>
          <div className="ensign">DEADLINE PRISON · NO.<span className="no">0614</span></div>
          <p className="tag">把自己關進來,<b>服完這一頁死線</b>。<br />沒有逃獄,只有交稿。</p>
          <div className="crime">
            <span>罪名:<b>慣性拖稿</b></span>
            <span>刑期:<b>一個番茄鐘起</b></span>
            <span>保釋:<b>不受理</b></span>
          </div>
          <div className="hero-cta">
            <button className="cta-main" onClick={() => scrollTo('sessions')}>入監服刑 ▸</button>
            <button className="cta-ghost" onClick={() => scrollTo('about')}>服刑須知</button>
          </div>
          <div className="scroll-hint">▼ 向下了解服刑流程</div>
        </header>

        <div className="hazard" />

        {/* 監獄介紹 */}
        <section id="about">
          <div className="eyebrow reveal">服刑須知 <span className="blk">// BLOCK 01</span></div>
          <h2 className="title reveal">這裡關的,<br />是趕不完稿的人</h2>
          <p className="subline reveal">死線監獄是一間以「番茄鐘」執行的趕稿收容所。入監即上鎖,鈴響才放風,全程同步直播犯人服刑進度——你不是一個人在趕,是一群人一起服刑。</p>
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
              <span><i style={{ background: 'var(--alarm)' }} />長休 15 分(每 4 輪)</span>
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
                  <div className="height" />
                  {p.img ? <img src={p.img} alt={p.role} /> : <div className="initial">{p.role[0] || '?'}</div>}
                  <div className="plate">{p.no}</div>
                </div>
                <div className="body">
                  <div className="role">{p.role}</div>
                  <h4>{p.name}</h4>
                  <p className="bio">{p.bio}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="hazard" />

        {/* 趕稿場次 */}
        <section id="sessions">
          <div className="eyebrow reveal">服刑梯次 <span className="blk">// BLOCK 03</span></div>
          <h2 className="title reveal">近期趕稿場次</h2>
          <p className="subline reveal">選一個梯次自首入監。額滿停止收監,過期梯次已結案。</p>
          <div className="sessions reveal">
            {loading ? <p style={{ color: 'var(--dim)' }}>調閱梯次中…</p>
              : sessions.length === 0 ? <p style={{ color: 'var(--dim)' }}>目前沒有開放收監的梯次</p>
                : sessions.map(s => {
                  const st = sessionStatus(s)
                  const { dd, mm } = splitDate(s.dateISO)
                  const pct = s.capacity > 0 ? Math.min(100, Math.round(s.booked / s.capacity * 100)) : 0
                  const capTxt = s.capacity > 0 ? `已收監 ${s.booked} / ${s.capacity}` : `已收監 ${s.booked} ／ 不限`
                  const tag = st === 'ended' ? '已結束' : st === 'full' ? '停止收監' : '報名中'
                  return (
                    <div className={`sess ${st}`} key={s.id}>
                      <div className="when"><div className="d">{dd}</div><div className="m">{mm}</div></div>
                      <div className="meta">
                        <div className="batch">{s.batch}</div>
                        <h4>{s.title}</h4>
                        <div className="cap">{capTxt}{s.capacity > 0 && <span className="gauge"><i style={{ width: `${pct}%` }} /></span>}</div>
                      </div>
                      <div className="act">
                        <span className={`tag-status ${st}`}>{tag}</span>
                        {st === 'ended' ? <button className="btn-book" disabled>已結案</button>
                          : st === 'full' ? <button className="btn-book" disabled>已額滿</button>
                            : <button className="btn-book" onClick={() => openModal(s)}>入監服刑</button>}
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
                  <p className="m-note">入監採 <b style={{ color: 'var(--text)' }}>Discord 登入</b>,登入後自動帶入你的 DC 身分作為服刑名冊紀錄,無需另填聯絡方式。</p>
                  <button className="m-dc" onClick={loginWithDiscord}><DiscordIcon />以 Discord 登入入監</button>
                </>
              ) : active ? (
                <>
                  <p className="m-note">你已在此梯次服刑名冊上(狀態:<b style={{ color: 'var(--text)' }}>{selBooking.status}</b>)。</p>
                  <button className="m-dc m-ghost" onClick={cancel} disabled={submitting}>取消預約</button>
                </>
              ) : selBooking ? (
                <>
                  <p className="m-note">你先前已取消此梯次。要重新登記入監名冊嗎?</p>
                  <button className="m-dc m-confirm" onClick={rebook} disabled={submitting}>{submitting ? '處理中…' : '重新報名'}</button>
                </>
              ) : (
                <>
                  <p className="m-note">以 <b style={{ color: 'var(--text)' }}>你的 Discord 身分</b>入監,確認後登入服刑名冊。</p>
                  <button className="m-dc m-confirm" onClick={confirmBooking} disabled={submitting}>{submitting ? '收監中…' : '確認入監'}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
