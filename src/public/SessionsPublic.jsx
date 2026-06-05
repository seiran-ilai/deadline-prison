import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// 近期趕稿場次(免登入):讀 public_sessions()(open 場次 + 已預約數 + 上限)。
// 每場一顆「入監服刑」→ /serve?session_id;額滿則 disable。
export default function SessionsPublic() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    supabase.rpc('public_sessions').then(({ data }) => {
      if (alive) { setRows(data ?? []); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  return (
    <div>
      <h1>近期趕稿場次</h1>
      {loading ? <p style={{ color: '#888' }}>載入場次中…</p>
        : rows.length === 0 ? <p style={{ color: '#888' }}>目前沒有開放預約的場次</p>
          : rows.map(s => {
            const full = s.capacity != null && s.booked >= s.capacity
            const cap = s.capacity != null ? ` / ${s.capacity}` : ''
            return (
              <div key={s.id} style={{ border: '1px solid #333', borderRadius: 8, padding: 16, marginBottom: 12, background: '#222', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ fontSize: 17 }}>{s.title}</strong>
                  <div style={{ color: '#aaa', fontSize: 14, marginTop: 4 }}>
                    {s.session_date ?? '日期未定'} · 已預約 {s.booked}{cap} {full && <span style={{ color: '#e07a5a' }}>· 本梯次已額滿</span>}
                  </div>
                </div>
                <span style={{ flex: 1 }} />
                {full ? (
                  <button disabled style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#444', color: '#888', cursor: 'not-allowed' }}>本梯次已額滿</button>
                ) : (
                  <Link to={`/serve?session_id=${s.id}`} style={{ padding: '8px 16px', borderRadius: 6, textDecoration: 'none', background: '#e0b04a', color: '#1a1a1a', fontWeight: 700 }}>入監服刑</Link>
                )}
              </div>
            )
          })}
    </div>
  )
}
