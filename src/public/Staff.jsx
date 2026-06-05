import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

// 監獄人員(獄方名冊,免登入):讀 public_staff() RPC(SECURITY DEFINER,只回 guard/warden 公開欄位)。
export default function Staff() {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    supabase.rpc('public_staff').then(({ data }) => {
      if (alive) { setStaff(data ?? []); setLoading(false) }
    })
    return () => { alive = false }
  }, [])

  const wardens = staff.filter(s => s.role === 'warden')
  const guards = staff.filter(s => s.role === 'guard')

  return (
    <div>
      <h1>監獄人員</h1>
      {loading ? <p style={{ color: '#888' }}>載入名冊中…</p> : (
        <>
          <Group title="典獄長" people={wardens} accent="#e0b04a" />
          <Group title="獄卒" people={guards} accent="#c98a3a" />
          {staff.length === 0 && <p style={{ color: '#888' }}>名冊尚未公開</p>}
        </>
      )}
    </div>
  )
}

function Group({ title, people, accent }) {
  if (!people.length) return null
  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={{ color: accent }}>{title}</h3>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {people.map(p => {
          const name = p.game_name ?? p.display_name ?? '(未具名)'
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #333', borderRadius: 8, padding: '10px 14px', background: '#222' }}>
              {p.avatar_url
                ? <img src={p.avatar_url} alt="" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                : <div style={{ width: 44, height: 44, borderRadius: '50%', background: accent, color: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{name[0]}</div>}
              <strong>{name}</strong>
            </div>
          )
        })}
      </div>
    </section>
  )
}
