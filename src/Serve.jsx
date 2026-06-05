import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { createBooking, cancelBooking } from './bookingApi'

// /serve — 入監服刑(預約流程)。未登入觸發 Discord OAuth;身分以伺服器端 token 為準。
export default function Serve() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') || ''
  const [user, setUser] = useState(undefined) // undefined=載入中, null=未登入
  const [sess, setSess] = useState(null)       // public_sessions 中對應的場次
  const [myBooking, setMyBooking] = useState(null) // 我這場的 booking(含 cancelled)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const u = session?.user ?? null
    setUser(u)
    const { data: pub } = await supabase.rpc('public_sessions')
    setSess((pub ?? []).find(s => s.id === sessionId) ?? null)
    if (u && sessionId) {
      const { data: b } = await supabase.from('bookings')
        .select('id, status').eq('session_id', sessionId).eq('user_id', u.id).maybeSingle()
      setMyBooking(b ?? null)
    } else {
      setMyBooking(null)
    }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { reload() }, [reload])

  async function login() {
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${window.location.origin}/serve?session_id=${sessionId}` },
    })
  }

  async function submit() {
    setBusy(true); setMsg('')
    const r = await createBooking(sessionId, note)
    setBusy(false)
    if (r.ok) { setMsg('🔒 收監成功!到時準時報到服刑。'); reload(); return }
    const map = {
      already_booked: '你已在此梯次服刑名單上。',
      full: '本梯次已額滿。',
      not_authenticated: '請先登入。',
      session_not_found: '查無此場次。',
    }
    setMsg(map[r.error] ?? ('預約失敗:' + (r.error ?? r.detail ?? r.status)))
    reload()
  }

  async function cancel() {
    if (!window.confirm('確定取消本梯次預約?')) return
    setBusy(true)
    const r = await cancelBooking(myBooking.id)
    setBusy(false)
    setMsg(r.ok ? '已取消預約。' : ('取消失敗:' + r.error))
    reload()
  }

  // 重新報名(先前已取消):回填 pending,前端輕量擋額滿
  async function rebook() {
    if (sess?.capacity != null && sess.booked >= sess.capacity) { setMsg('本梯次已額滿。'); return }
    setBusy(true)
    const { error } = await supabase.from('bookings').update({ status: 'pending' }).eq('id', myBooking.id)
    setBusy(false)
    setMsg(error ? ('重新報名失敗:' + error.message) : '🔒 已重新入監名單。')
    reload()
  }

  const card = { border: '1px solid #333', borderRadius: 8, padding: 20, background: '#222', marginTop: 16 }
  const primary = { padding: '8px 18px', borderRadius: 6, border: 'none', background: '#e0b04a', color: '#1a1a1a', fontWeight: 700, cursor: 'pointer' }
  const ghost = { padding: '8px 18px', borderRadius: 6, border: '1px solid #555', background: 'transparent', color: '#ccc', cursor: 'pointer' }

  if (!sessionId) return <Shell><p>缺少場次參數,請從 <Link to="/sessions" style={{ color: '#e0b04a' }}>近期場次</Link> 進入。</p></Shell>
  if (loading || user === undefined) return <Shell><p style={{ color: '#888' }}>讀取中…</p></Shell>
  if (!sess) return <Shell><p>查無此場次,或該場次已關閉。<br /><Link to="/sessions" style={{ color: '#e0b04a' }}>← 回近期場次</Link></p></Shell>

  const full = sess.capacity != null && sess.booked >= sess.capacity
  const cap = sess.capacity != null ? ` / ${sess.capacity}` : ''
  const active = myBooking && myBooking.status !== 'cancelled'

  return (
    <Shell>
      <div style={card}>
        <h2 style={{ margin: '0 0 4px' }}>{sess.title}</h2>
        <div style={{ color: '#aaa' }}>{sess.session_date ?? '日期未定'} · 已預約 {sess.booked}{cap}</div>

        {msg && <p style={{ marginTop: 16, padding: '8px 12px', borderRadius: 6, background: '#33312a', color: '#e0b04a' }}>{msg}</p>}

        <div style={{ marginTop: 16 }}>
          {user === null ? (
            <>
              <p style={{ color: '#bbb' }}>預約需用 Discord 登入(身分自動帶入,不需另外填)。</p>
              <button style={primary} onClick={login}>用 Discord 登入並預約</button>
            </>
          ) : active ? (
            <>
              <p style={{ color: '#7ec07e' }}>✅ 你已在此梯次服刑名單上(狀態:{myBooking.status})。</p>
              <button style={ghost} onClick={cancel} disabled={busy}>取消預約</button>
            </>
          ) : myBooking ? (
            <>
              <p style={{ color: '#bbb' }}>你先前已取消此梯次。</p>
              <button style={primary} onClick={rebook} disabled={busy || full}>{full ? '本梯次已額滿' : '重新報名'}</button>
            </>
          ) : full ? (
            <p style={{ color: '#e07a5a' }}>本梯次已額滿,無法預約。</p>
          ) : (
            <>
              <label style={{ display: 'block', color: '#bbb', marginBottom: 6 }}>備註(選填)</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="想對典獄長說的話…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #555', background: '#1a1a1a', color: '#eee', marginBottom: 12 }} />
              <button style={primary} onClick={submit} disabled={busy}>{busy ? '收監中…' : '確認入監服刑'}</button>
            </>
          )}
        </div>
      </div>

      <p style={{ marginTop: 16 }}><Link to="/sessions" style={{ color: '#888' }}>← 回近期場次</Link></p>
    </Shell>
  )
}

function Shell({ children }) {
  return <div style={{ color: '#eee' }}><h1>入監服刑</h1>{children}</div>
}
