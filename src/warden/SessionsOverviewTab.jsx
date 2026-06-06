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

  return (
    <div>
      <h3>場次總覽</h3>

      {/* 開新場次(重用開場流程) */}
      <div className="toolbar">
        <input className="inp" placeholder="場次名(如 6/14 晚場)" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
        <input type="number" min="1" placeholder="人數上限(空=不限)" value={newCap} onChange={e => setNewCap(e.target.value)} style={{ width: 160 }} />
        <button className="btn-pri" onClick={openNew}>開新場次</button>
      </div>

      {loading ? <p className="empty">載入中…</p>
        : sessions.length === 0 ? <p className="empty">還沒有任何場次</p>
          : sessions.map(s => (
            <div key={s.id} className="row-card">
              {editId === s.id ? (
                <div className="row-head">
                  <input className="inp" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                  <input type="number" min="1" placeholder="上限(空=不限)" value={editCap} onChange={e => setEditCap(e.target.value)} style={{ width: 130 }} />
                  <button onClick={() => saveEdit(s.id)}>儲存</button>
                  <button onClick={cancelEdit}>取消</button>
                </div>
              ) : (
                <div className="row-head">
                  <strong>{s.title}</strong>
                  <span className="muted">{s.session_date ?? '未設定日期'}</span>
                  <span className="tag tag-pill" style={s.status === 'open'
                    ? { background: 'rgba(63,179,107,.15)', color: 'var(--ok)' }
                    : { background: 'rgba(255,255,255,.08)', color: 'var(--dim)' }}>
                    {s.status === 'open' ? '進行中' : '已結束'}</span>
                  <span className="muted">報到 {counts[s.id] ?? 0} 人</span>
                  <span className="muted">上限 {s.capacity ?? '不限'}</span>
                  <span className="spacer" />
                  <button className="btn-sm" onClick={() => startEdit(s)}>編輯</button>
                  <button className="btn-sm" onClick={() => toggleStatus(s)}>{s.status === 'open' ? '關閉場次' : '重新開啟'}</button>
                  <button className="btn-sm btn-danger" onClick={() => deleteSession(s)}>刪除</button>
                </div>
              )}
            </div>
          ))}
    </div>
  )
}
