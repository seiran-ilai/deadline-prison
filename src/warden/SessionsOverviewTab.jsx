import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

// 場次總覽(僅典獄長):列出所有場次、開新場、編輯(標題/日期)、關閉/重新開啟、刪除。
// 不放番茄鐘控制與直播(那些屬「進行中場次」分頁的控場,避免重複)。
export default function SessionsOverviewTab({ setMsg, reloadShared }) {
  const [sessions, setSessions] = useState([])
  const [counts, setCounts] = useState({})        // session_id -> 報到人數
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newCap, setNewCap] = useState('')          // 人數上限(空 = 不限)
  const [editId, setEditId] = useState(null)       // 編輯中的場次 id
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editCap, setEditCap] = useState('')

  // 載入所有場次 + 各場人數(分開查再 JS 合併,不用巢狀 select)
  async function load() {
    setLoading(true)
    const { data: sess } = await supabase.from('sessions')
      .select('id, title, session_date, status, opened_by, capacity, created_at')
    const { data: si } = await supabase.from('session_inmates').select('session_id')
    const cnt = {}
    for (const r of si ?? []) cnt[r.session_id] = (cnt[r.session_id] ?? 0) + 1
    // 排序:進行中(open)在上、已結束(closed)在下;同組內依日期由近到遠
    const rank = s => (s.status === 'open' ? 0 : 1)
    const dateKey = s => new Date(s.session_date ?? s.created_at).getTime()
    const sorted = (sess ?? []).slice().sort((a, b) => rank(a) - rank(b) || dateKey(b) - dateKey(a))
    setSessions(sorted); setCounts(cnt); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // 把上限輸入轉成 int 或 null(空白 / 非正整數 → null = 不限)
  const capValue = (v) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 ? n : null }

  async function openNew() {
    if (!newTitle) { setMsg('請填場次名'); return }
    const payload = { title: newTitle }
    if (newDate) payload.session_date = newDate
    payload.capacity = capValue(newCap)
    const { error } = await supabase.from('sessions').insert(payload)
    if (error) { setMsg('開場失敗:' + error.message); return }
    setMsg('已開場:' + newTitle); setNewTitle(''); setNewDate(''); setNewCap('')
    load(); reloadShared()
  }

  function startEdit(s) {
    setEditId(s.id); setEditTitle(s.title ?? ''); setEditDate(s.session_date ?? ''); setEditCap(s.capacity ?? '')
  }
  function cancelEdit() { setEditId(null); setEditTitle(''); setEditDate(''); setEditCap('') }

  async function saveEdit(id) {
    if (!editTitle) { setMsg('場次名不能空白'); return }
    const { error } = await supabase.from('sessions')
      .update({ title: editTitle, session_date: editDate || null, capacity: capValue(editCap) }).eq('id', id)
    if (error) { setMsg('編輯失敗:' + error.message); return }
    setMsg('已更新場次'); cancelEdit(); load(); reloadShared()
  }

  async function toggleStatus(s) {
    const next = s.status === 'open' ? 'closed' : 'open'
    const { error } = await supabase.from('sessions').update({ status: next }).eq('id', s.id)
    if (error) { setMsg('狀態更新失敗:' + error.message); return }
    setMsg(next === 'closed' ? '已關閉場次' : '已重新開啟場次'); load(); reloadShared()
  }

  async function deleteSession(s) {
    if (!window.confirm(`確定刪除場次「${s.title}」?此動作無法復原,本場名單與目標也會一併移除`)) return
    const { error } = await supabase.from('sessions').delete().eq('id', s.id)
    if (error) { setMsg('刪除失敗:' + error.message); return }
    setMsg('已刪除場次'); load(); reloadShared()
  }

  const btn = { padding: '2px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }
  const btnDanger = { ...btn, color: '#c00' }
  const tag = (bg) => ({ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: bg, color: '#fff' })

  return (
    <div>
      <h3>場次總覽</h3>

      {/* 開新場次(重用開場流程) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="場次名(如 6/14 晚場)" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
          style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }} />
        <input type="number" min="1" placeholder="人數上限(空=不限)" value={newCap} onChange={e => setNewCap(e.target.value)}
          style={{ width: 140, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }} />
        <button onClick={openNew}>開新場次</button>
      </div>

      {loading ? <p style={{ color: '#888' }}>載入中…</p>
        : sessions.length === 0 ? <p style={{ color: '#888' }}>還沒有任何場次</p>
          : sessions.map(s => (
            <div key={s.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8, background: '#fff', color: '#222' }}>
              {editId === s.id ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }} />
                  <input type="number" min="1" placeholder="上限(空=不限)" value={editCap} onChange={e => setEditCap(e.target.value)}
                    style={{ width: 120, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }} />
                  <button style={btn} onClick={() => saveEdit(s.id)}>儲存</button>
                  <button style={btn} onClick={cancelEdit}>取消</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong>{s.title}</strong>
                  <span style={{ color: '#888', fontSize: 13 }}>{s.session_date ?? '未設定日期'}</span>
                  <span style={tag(s.status === 'open' ? '#2a8' : '#888')}>{s.status === 'open' ? '進行中' : '已結束'}</span>
                  <span style={{ color: '#666', fontSize: 13 }}>報到 {counts[s.id] ?? 0} 人</span>
                  <span style={{ color: '#666', fontSize: 13 }}>上限 {s.capacity ?? '不限'}</span>
                  <span style={{ flex: 1 }} />
                  <button style={btn} onClick={() => startEdit(s)}>編輯</button>
                  <button style={btn} onClick={() => toggleStatus(s)}>{s.status === 'open' ? '關閉場次' : '重新開啟'}</button>
                  <button style={btnDanger} onClick={() => deleteSession(s)}>刪除</button>
                </div>
              )}
            </div>
          ))}
    </div>
  )
}
