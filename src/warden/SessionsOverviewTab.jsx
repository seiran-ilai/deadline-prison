import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { normalizeStatus, SESSION_STATUS_LABEL } from './constants'
import GuardAssign from './GuardAssign'

// 場次總覽(僅典獄長):列出所有場次、開新場、編輯(標題/日期)、五態狀態機、刪除。
// 不放番茄鐘控制與直播(那些屬「進行中場次」分頁的控場,避免重複)。
// 未結束場次可展開唯讀檢視本場名單(犯人列可就地指派/移除專屬獄卒);已結束場次不可展開。
// 場次狀態一律以 normalizeStatus(s) 判斷,不直接比對 s.status。
export default function SessionsOverviewTab({ setMsg, reloadShared }) {
  const [sessions, setSessions] = useState([])
  const [counts, setCounts] = useState({})        // session_id -> 報到人數
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newCap, setNewCap] = useState('')          // 人數上限(空 = 不限)
  const [newPublic, setNewPublic] = useState(true)  // 對外公開(預設公開)
  const [editId, setEditId] = useState(null)       // 編輯中的場次 id
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editCap, setEditCap] = useState('')
  const [editPublic, setEditPublic] = useState(true)
  const [expandedId, setExpandedId] = useState(null) // 展開檢視中的場次 id(僅 open)
  const [rosterById, setRosterById] = useState({})   // session_id -> { inmates:[], guards:[] }

  // 載入所有場次 + 各場人數(分開查再 JS 合併,不用巢狀 select)
  async function load() {
    setLoading(true)
    const { data: sess } = await supabase.from('sessions')
      .select('id, title, session_date, status, timer_started_at, opened_by, capacity, created_at, is_public')
    const { data: si } = await supabase.from('session_inmates').select('session_id')
    const cnt = {}
    for (const r of si ?? []) cnt[r.session_id] = (cnt[r.session_id] ?? 0) + 1
    // 排序:未結束在上、已結束(ended)在下;同組內依日期由近到遠
    const rank = s => (normalizeStatus(s) === 'ended' ? 1 : 0)
    const dateKey = s => new Date(s.session_date ?? s.created_at).getTime()
    const sorted = (sess ?? []).slice().sort((a, b) => rank(a) - rank(b) || dateKey(b) - dateKey(a))
    setSessions(sorted); setCounts(cnt); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // 展開/收合某場次(已結束不可展開);展開時載入本場名單(分開查再 JS 合併,不用巢狀 select)
  async function toggleExpand(s) {
    if (normalizeStatus(s) === 'ended') return
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
    const payload = { title: newTitle, is_public: newPublic }
    if (newDate) payload.session_date = newDate
    payload.capacity = capValue(newCap)
    const { error } = await supabase.from('sessions').insert(payload)
    if (error) { setMsg('開場失敗:' + error.message); return }
    setMsg('已開場:' + newTitle); setNewTitle(''); setNewDate(''); setNewCap(''); setNewPublic(true)
    load(); reloadShared()
  }

  function startEdit(s) {
    setEditId(s.id); setEditTitle(s.title ?? ''); setEditDate(s.session_date ?? ''); setEditCap(s.capacity ?? '')
    setEditPublic(s.is_public !== false)   // 帶入現值(null/undefined 視為公開)
  }
  function cancelEdit() { setEditId(null); setEditTitle(''); setEditDate(''); setEditCap(''); setEditPublic(true) }

  async function saveEdit(id) {
    if (!editTitle) { setMsg('場次名不能空白'); return }
    const { error } = await supabase.from('sessions')
      .update({ title: editTitle, session_date: editDate || null, capacity: capValue(editCap), is_public: editPublic }).eq('id', id)
    if (error) { setMsg('編輯失敗:' + error.message); return }
    setMsg('已更新場次'); cancelEdit(); load(); reloadShared()
  }

  // 場次五態狀態機:一律走 set_session_status RPC,成功後刷新本頁與共用資料。
  // confirmText 有值時先二次確認(結束服刑、退回入場用)。
  async function setStatus(s, newStatus, okMsg, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    const { error } = await supabase.rpc('set_session_status', { p_session: s.id, p_new_status: newStatus })
    if (error) { setMsg('狀態更新失敗:' + error.message); return }
    setMsg(okMsg); load(); reloadShared()
  }

  // 依 normalizeStatus(s) 顯示對應狀態機按鈕(退回類用次要/危險色與正向鈕區隔)
  function statusButtons(s) {
    switch (normalizeStatus(s)) {
      case 'booking':
        return (<>
          <button className="btn-sm" onClick={() => setStatus(s, 'booking_paused', '已停止預約')}>停止預約</button>
          <button className="btn-sm btn-pri" onClick={() => setStatus(s, 'intake', '已開始入場')}>開始入場</button>
        </>)
      case 'booking_paused':
        return (<>
          <button className="btn-sm" onClick={() => setStatus(s, 'booking', '已恢復報名')}>恢復報名</button>
          <button className="btn-sm btn-pri" onClick={() => setStatus(s, 'intake', '已開始入場')}>開始入場</button>
        </>)
      case 'intake':
        return (<>
          <button className="btn-sm btn-pri" onClick={() => setStatus(s, 'serving', '已開始服刑')}>開始服刑</button>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'booking_paused', '已退回停止預約')}>退回停止預約</button>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'booking', '已退回預約中')}>退回預約中</button>
        </>)
      case 'serving':
        return (<>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'ended', '已結束服刑', '確定結束本場服刑?結束後不可重開')}>結束服刑</button>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'intake', '已退回入場', '將清掉番茄鐘計時、退回入場狀態,全場回到等待')}>退回入場(清番茄鐘)</button>
        </>)
      default:   // ended:不顯示狀態機按鈕
        return <span className="muted">已結束</span>
    }
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
        <label><input type="checkbox" checked={newPublic} onChange={e => setNewPublic(e.target.checked)} />對外公開</label>
        <button className="btn-pri" onClick={openNew}>開新場次</button>
      </div>

      {loading ? <p className="empty">載入中…</p>
        : sessions.length === 0 ? <p className="empty">還沒有任何場次</p>
          : sessions.map(s => {
            const isOpen = expandedId === s.id
            const roster = rosterById[s.id]
            const st = normalizeStatus(s)
            const ended = st === 'ended'
            return (
            <div key={s.id} className="row-card">
              {editId === s.id ? (
                <div className="row-head">
                  <input className="inp" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                  <input type="number" min="1" placeholder="上限(空=不限)" value={editCap} onChange={e => setEditCap(e.target.value)} style={{ width: 130 }} />
                  <label><input type="checkbox" checked={editPublic} onChange={e => setEditPublic(e.target.checked)} />對外公開</label>
                  <button onClick={() => saveEdit(s.id)}>儲存</button>
                  <button onClick={cancelEdit}>取消</button>
                </div>
              ) : (
                <div className="row-head">
                  {/* 未結束場次左側可展開箭頭;已結束不顯示、不可展開 */}
                  {!ended
                    ? <button className="btn-sm so-caret" onClick={() => toggleExpand(s)}>{isOpen ? '▾' : '▸'}</button>
                    : <span className="so-caret-ph" aria-hidden="true" />}
                  <strong>{s.title}</strong>
                  <span className="muted">{s.session_date ?? '未設定日期'}</span>
                  <span className="tag tag-pill" style={!ended
                    ? { background: 'rgba(63,179,107,.15)', color: 'var(--ok)' }
                    : { background: 'rgba(255,255,255,.08)', color: 'var(--dim)' }}>
                    {SESSION_STATUS_LABEL[st] ?? st}</span>
                  <span className="tag tag-pill" style={s.is_public !== false
                    ? { background: 'rgba(245,197,24,.12)', color: 'var(--hazard)' }
                    : { background: 'rgba(255,255,255,.06)', color: 'var(--faint)' }}>
                    {s.is_public !== false ? '官網公開' : '內部場'}</span>
                  <span className="muted">報到 {counts[s.id] ?? 0} 人</span>
                  <span className="muted">上限 {s.capacity ?? '不限'}</span>
                  <span className="spacer" />
                  <button className="btn-sm" onClick={() => startEdit(s)}>編輯</button>
                  {statusButtons(s)}
                  <button className="btn-sm btn-danger" onClick={() => deleteSession(s)}>刪除</button>
                </div>
              )}

              {/* 展開:唯讀檢視本場名單(犯人列右側嵌 GuardAssign 指派/移除專屬獄卒)。已結束場次不可展開。 */}
              {isOpen && !ended && (
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
