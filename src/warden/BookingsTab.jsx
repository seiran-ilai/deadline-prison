import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import AvatarInput from '../AvatarInput'

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
  const [editing, setEditing] = useState(null)   // 編輯暱稱/頭像中的 booking { id, game_name, avatar_url }

  async function load() {
    setLoading(true)
    const { data: bk } = await supabase.from('bookings')
      .select('id, session_id, dc_id, dc_name, note, status, created_at, game_name, avatar_url').order('created_at')
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

  async function saveBookingInfo() {
    const e = editing
    const { error } = await supabase.from('bookings')
      .update({ game_name: e.game_name || null, avatar_url: e.avatar_url || null }).eq('id', e.id)
    if (error) { setMsg('更新預約資料失敗:' + error.message); return }
    setMsg('已更新預約暱稱/頭像'); setEditing(null); load()
  }

  return (
    <div>
      <h3>預約總覽</h3>
      {loading ? <p className="empty">載入中…</p>
        : sessions.length === 0 ? <p className="empty">目前沒有任何預約</p>
          : sessions.map(s => {
            const rows = bySession[s.id] ?? []
            const isOpen = expanded === s.id
            const cap = s.capacity != null ? ` / ${s.capacity}` : ''
            return (
              <div key={s.id} className="row-card">
                <div className="row-head clickable" onClick={() => setExpanded(isOpen ? null : s.id)}>
                  <strong>{s.title}</strong>
                  <span className="muted">{s.session_date ?? '未定'}</span>
                  <span className="tag tag-pill" style={s.status === 'open'
                    ? { background: 'rgba(63,179,107,.15)', color: 'var(--ok)' }
                    : { background: 'rgba(255,255,255,.08)', color: 'var(--dim)' }}>{s.status === 'open' ? '進行中' : '已結束'}</span>
                  <span className="muted">已預約 {bookedCount(s.id)}{cap}</span>
                  <span className="spacer" />
                  <span className="muted">{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div className="row-detail">
                    {rows.map(b => {
                      const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending
                      return (
                        <div key={b.id} className="sub-row">
                          {b.avatar_url && <img className="avatar" src={b.avatar_url} alt="" />}
                          <strong>{b.dc_name}</strong>
                          {b.game_name && <span className="muted">暱稱:{b.game_name}</span>}
                          <span className="faint">DC:{b.dc_id}</span>
                          {b.note && <span className="muted">備註:{b.note}</span>}
                          <span className="tag tag-pill" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                          <span className="faint">{new Date(b.created_at).toLocaleString()}</span>
                          <span className="spacer" />
                          <button className="btn-sm" onClick={() => setEditing({ id: b.id, game_name: b.game_name ?? '', avatar_url: b.avatar_url ?? '' })}>編輯暱稱/頭像</button>
                          {b.status !== 'confirmed' && <button className="btn-sm" onClick={() => setStatus(b, 'confirmed')}>確認</button>}
                          {b.status !== 'pending' && <button className="btn-sm" onClick={() => setStatus(b, 'pending')}>改待確認</button>}
                          {b.status !== 'cancelled' && <button className="btn-sm btn-danger" onClick={() => setStatus(b, 'cancelled')}>取消</button>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

      {/* 編輯預約暱稱/頭像 modal(沿用 AvatarInput;只改該筆預約的展示值,不動身分) */}
      {editing && (
        <div className="admin-modal-bg" onClick={() => setEditing(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>編輯預約暱稱/頭像</h3>
            <label>暱稱
              <input value={editing.game_name} onChange={e => setEditing({ ...editing, game_name: e.target.value })} />
            </label>
            <div className="field">
              <span className="field-lbl">頭像</span>
              <AvatarInput value={editing.avatar_url} onChange={url => setEditing({ ...editing, avatar_url: url })} userId={editing.id} />
            </div>
            <div className="modal-acts">
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="btn-pri" onClick={saveBookingInfo}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
