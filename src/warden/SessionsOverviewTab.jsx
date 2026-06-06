import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import GuardAssign from './GuardAssign'

// 場次總覽(僅典獄長):列出所有場次、開新場、編輯(標題/日期)、關閉/重新開啟、刪除。
// 不放番茄鐘控制與直播(那些屬「進行中場次」分頁的控場,避免重複)。
// open 場次可展開唯讀檢視本場名單(犯人列可就地指派/移除專屬獄卒);closed 場次不可展開。
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
  const [expandedId, setExpandedId] = useState(null) // 展開檢視中的場次 id(僅 open)
  const [rosterById, setRosterById] = useState({})   // session_id -> { inmates:[], guards:[] }

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

  // 展開/收合某場次(僅 open 可展開);展開時載入本場名單(分開查再 JS 合併,不用巢狀 select)
  async function toggleExpand(s) {
    if (s.status !== 'open') return
    if (expandedId === s.id) { setExpandedId(null); return }
    setExpandedId(s.id)
    if (rosterById[s.id]) return
    const { data: si } = await supabase.from('session_inmates')
      .select('id, member_id, role_in_session, state').eq('session_id', s.id)
    if (!si || !si.length) { setRosterById(prev => ({ ...prev, [s.id]: { inmates: [], guards: [] } })); return }
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', si.map(r => r.member_id))
    const profById = {}; for (const p of profs ?? []) profById[p.id] = p
    const merged = si.map(r => ({ id: r.id, member_id: r.member_id, role_in_session: r.role_in_session, state: r.state, profile: profById[r.member_id] }))
    setRosterById(prev => ({
      ...prev,
      [s.id]: {
        inmates: merged.filter(m => m.role_in_session !== 'guard'),
        guards: merged.filter(m => m.role_in_session === 'guard'),
      },
    }))
  }

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
          : sessions.map(s => {
            const isOpen = expandedId === s.id
            const roster = rosterById[s.id]
            return (
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
                  {/* open 場次左側可展開箭頭;closed 不顯示、不可展開 */}
                  {s.status === 'open'
                    ? <button className="btn-sm so-caret" onClick={() => toggleExpand(s)}>{isOpen ? '▾' : '▸'}</button>
                    : <span className="so-caret-ph" aria-hidden="true" />}
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

              {/* 展開:唯讀檢視本場名單(犯人列右側嵌 GuardAssign 指派/移除專屬獄卒)。僅 open 場次。 */}
              {isOpen && s.status === 'open' && (
                <div className="row-detail">
                  {!roster ? <p className="empty">讀取本場名單中…</p> : (<>
                    <div className="group-lbl">本場犯人 ({roster.inmates.length})<span className="ln" /></div>
                    {roster.inmates.length === 0 ? <p className="empty">本場沒有犯人</p> : roster.inmates.map(r => (
                      <div key={r.id} className="inmate">
                        <div className="in-av">
                          {r.profile?.avatar_url
                            ? <img src={r.profile.avatar_url} alt="" />
                            : (r.profile?.game_name ?? r.profile?.display_name ?? '?')[0]}
                        </div>
                        <div>
                          <div className="in-nm">{r.profile?.game_name ?? r.profile?.display_name ?? '(未知)'}</div>
                          <div className="in-no">No.{r.profile?.inmate_no != null ? String(r.profile.inmate_no).padStart(4, '0') : '----'}</div>
                        </div>
                        <span className="spacer" />
                        <GuardAssign sessionInmateId={r.id} guardRoster={roster.guards} setMsg={setMsg} />
                      </div>
                    ))}

                    <div className="group-lbl">本場獄卒 ({roster.guards.length})<span className="ln" /></div>
                    {roster.guards.length === 0 ? <p className="empty">本場沒有獄卒</p> : (
                      <div className="guard-grid">
                        {roster.guards.map(r => (
                          <div key={r.id} className="guard-cell">
                            <div className="g-av">
                              {r.profile?.avatar_url
                                ? <img src={r.profile.avatar_url} alt="" />
                                : (r.profile?.game_name ?? r.profile?.display_name ?? '?')[0]}
                            </div>
                            <div className="g-nm">{r.profile?.game_name ?? r.profile?.display_name ?? '(未知)'}</div>
                            <span className="role-tag guard">{r.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>)}
                </div>
              )}
            </div>
          )})}
    </div>
  )
}
