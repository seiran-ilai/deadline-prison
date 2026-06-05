import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

const STATUS_STYLE = {
  pending: { label: '待確認', bg: '#e0b04a', color: '#1a1a1a' },
  confirmed: { label: '已確認', bg: '#2a8', color: '#fff' },
  cancelled: { label: '已取消', bg: '#888', color: '#fff' },
}

// 預約總覽(僅典獄長):依場次分組列出 bookings,可改單筆狀態。
// 與場次總覽同源(已預約 = status != 'cancelled' 的數)。分開查 bookings / sessions 再 JS 合併。
export default function BookingsTab({ setMsg }) {
  const [sessions, setSessions] = useState([])      // 有預約的場次(含 title/date/capacity)
  const [bySession, setBySession] = useState({})    // session_id -> [booking]
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  async function load() {
    setLoading(true)
    const { data: bk } = await supabase.from('bookings')
      .select('id, session_id, dc_id, dc_name, note, status, created_at').order('created_at')
    const grouped = {}
    for (const b of bk ?? []) (grouped[b.session_id] ??= []).push(b)
    const sids = Object.keys(grouped)
    let sess = []
    if (sids.length) {
      const { data: ss } = await supabase.from('sessions')
        .select('id, title, session_date, capacity, status').in('id', sids)
      sess = ss ?? []
    }
    const rank = s => (s.status === 'open' ? 0 : 1)
    const dk = s => new Date(s.session_date ?? '2999-12-31').getTime()
    sess.sort((a, b) => rank(a) - rank(b) || dk(b) - dk(a))
    setSessions(sess); setBySession(grouped); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const bookedCount = (sid) => (bySession[sid] ?? []).filter(b => b.status !== 'cancelled').length

  async function setStatus(b, status) {
    if (status === 'cancelled' && !window.confirm('確定將這筆預約改為「已取消」?')) return
    const { error } = await supabase.from('bookings').update({ status }).eq('id', b.id)
    if (error) { setMsg('更新狀態失敗:' + error.message); return }
    setMsg('已更新預約狀態'); load()
  }

  const btn = { padding: '2px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }
  const tag = (st) => ({ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: st.bg, color: st.color })

  return (
    <div>
      <h3>預約總覽</h3>
      {loading ? <p style={{ color: '#888' }}>載入中…</p>
        : sessions.length === 0 ? <p style={{ color: '#888' }}>目前沒有任何預約</p>
          : sessions.map(s => {
            const rows = bySession[s.id] ?? []
            const isOpen = expanded === s.id
            const cap = s.capacity != null ? ` / ${s.capacity}` : ''
            return (
              <div key={s.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8, background: '#fff', color: '#222' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
                  onClick={() => setExpanded(isOpen ? null : s.id)}>
                  <strong>{s.title}</strong>
                  <span style={{ color: '#888', fontSize: 13 }}>{s.session_date ?? '未定'}</span>
                  <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: s.status === 'open' ? '#2a8' : '#888', color: '#fff' }}>{s.status === 'open' ? '進行中' : '已結束'}</span>
                  <span style={{ color: '#666', fontSize: 13 }}>已預約 {bookedCount(s.id)}{cap}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: '#888' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ marginTop: 10, borderTop: '1px dashed #ddd', paddingTop: 10 }}>
                    {rows.map(b => {
                      const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending
                      return (
                        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                          <strong>{b.dc_name}</strong>
                          <span style={{ color: '#aaa', fontSize: 12 }}>DC:{b.dc_id}</span>
                          {b.note && <span style={{ color: '#666', fontSize: 13 }}>備註:{b.note}</span>}
                          <span style={tag(st)}>{st.label}</span>
                          <span style={{ color: '#aaa', fontSize: 12 }}>{new Date(b.created_at).toLocaleString()}</span>
                          <span style={{ flex: 1 }} />
                          {b.status !== 'confirmed' && <button style={btn} onClick={() => setStatus(b, 'confirmed')}>確認</button>}
                          {b.status !== 'pending' && <button style={btn} onClick={() => setStatus(b, 'pending')}>改待確認</button>}
                          {b.status !== 'cancelled' && <button style={{ ...btn, color: '#c00' }} onClick={() => setStatus(b, 'cancelled')}>取消</button>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
    </div>
  )
}
