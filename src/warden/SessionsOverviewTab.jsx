import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { normalizeStatus, SESSION_STATUS_LABEL, materializeResultMsg } from './constants'
import { SESSION_KINDS, SESSION_KIND_LABEL, DEFAULT_SESSION_KIND } from '../sessionKind'
import GuardAssign from './GuardAssign'
import SessionGuardPlan from './SessionGuardPlan'
import { slotLabel } from '../slots'

const arr = v => Array.isArray(v) ? v : []

// 場次總覽(僅典獄長):列出所有場次、開新場、編輯(標題/日期)、五態狀態機、刪除。
// 不放番茄鐘控制與直播(那些屬「進行中場次」分頁的控場,避免重複)。
// 未結束場次可展開唯讀檢視本場名單(犯人列可就地指派/移除專屬獄卒);已結束場次不可展開。
// 場次狀態一律以 normalizeStatus(s) 判斷,不直接比對 s.status。
export default function SessionsOverviewTab({ setMsg, reloadShared, inmates = [] }) {
  // 指名互動場排班用:全體獄方人員(role = guard / warden)
  const staffPool = inmates.filter(p => p.role === 'guard' || p.role === 'warden')
    .slice().sort((a, b) => (a.inmate_no ?? 1e9) - (b.inmate_no ?? 1e9))   // 獄卒一律依犯人編號排序
  const [sessions, setSessions] = useState([])
  const [counts, setCounts] = useState({})        // session_id -> 報到人數
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newCap, setNewCap] = useState('')          // 人數上限(空 = 不限)
  const [newPublic, setNewPublic] = useState(true)  // 對外公開(預設公開)
  const [newKind, setNewKind] = useState(DEFAULT_SESSION_KIND)  // 場次類型
  const [newStart, setNewStart] = useState('')      // 指名場:開始時間(HH:MM)
  const [newSlots, setNewSlots] = useState('4')     // 指名場:半小時時格數
  const [newPw, setNewPw] = useState('')            // 通行密鑰(僅公開場可設;空 = 不設)
  const [editId, setEditId] = useState(null)       // 編輯中的場次 id
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editCap, setEditCap] = useState('')
  const [editPublic, setEditPublic] = useState(true)
  const [editKind, setEditKind] = useState(DEFAULT_SESSION_KIND)
  const [editStart, setEditStart] = useState('')
  const [editSlots, setEditSlots] = useState('4')
  const [editPw, setEditPw] = useState('')
  const [pwById, setPwById] = useState({})          // session_id -> 通行密鑰(RLS 僅典獄長可讀,後台直接顯示)
  const [expandedId, setExpandedId] = useState(null) // 展開檢視中的場次 id(僅 open)
  const [rosterById, setRosterById] = useState({})   // session_id -> { inmates:[], guards:[] }

  // 載入所有場次 + 各場人數(分開查再 JS 合併,不用巢狀 select)
  async function load() {
    setLoading(true)
    const { data: sess } = await supabase.from('sessions')
      .select('id, title, session_date, status, timer_started_at, opened_by, capacity, created_at, is_public, kind, start_time, slot_count')
    const { data: si } = await supabase.from('session_inmates').select('session_id, role_in_session')
    const { data: pws } = await supabase.from('session_passwords').select('session_id, password')
    const pwMap = {}
    for (const r of pws ?? []) pwMap[r.session_id] = r.password
    setPwById(pwMap)
    const cnt = {}
    for (const r of si ?? []) if (r.role_in_session !== 'guard') cnt[r.session_id] = (cnt[r.session_id] ?? 0) + 1   // 報到只計犯人
    // 排序:未結束在上、已結束(ended)在下;同組內依日期由近到遠
    const rank = s => (normalizeStatus(s) === 'ended' ? 1 : 0)
    const dateKey = s => new Date(s.session_date ?? s.created_at).getTime()
    const sorted = (sess ?? []).slice().sort((a, b) => rank(a) - rank(b) || dateKey(b) - dateKey(a))
    setSessions(sorted); setCounts(cnt); setLoading(false)
  }
  useEffect(() => { load() }, [])

  // 展開/收合某場次(已結束不可展開)。名冊改「預約 + 已入場 + 上班獄卒」union,並附本場預約清單。
  // 分開查再 JS 合併(不用巢狀 select)。
  async function loadExpand(sid) {
    const [siRes, bkRes, sgRes] = await Promise.all([
      supabase.from('session_inmates').select('id, member_id, role_in_session, state').eq('session_id', sid),
      supabase.from('bookings').select('id, user_id, game_name, dc_name, avatar_url, note, status, requested_slots, addons, capture, dc_channel_ready, created_at').eq('session_id', sid).order('created_at'),
      supabase.from('session_guards').select('guard_id').eq('session_id', sid),
    ])
    const si = siRes.data ?? [], bk = bkRes.data ?? [], sg = sgRes.data ?? []
    // profiles 需含:已入場成員、上班獄卒、以及預約指名/加購的對象獄卒
    const bkGuardIds = bk.flatMap(b => [...arr(b.requested_slots).map(p => p?.g), ...arr(b.addons).map(a => a?.g)]).filter(Boolean)
    const pids = [...new Set([...si.map(r => r.member_id), ...sg.map(r => r.guard_id), ...bkGuardIds])]
    const profById = {}
    if (pids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', pids)
      for (const p of profs ?? []) profById[p.id] = p
    }
    const merged = si.map(r => ({ id: r.id, member_id: r.member_id, role_in_session: r.role_in_session, state: r.state, profile: profById[r.member_id] }))
    const inmatesLive = merged.filter(m => m.role_in_session !== 'guard')
      .sort((a, b) => (a.profile?.inmate_no ?? 1e9) - (b.profile?.inmate_no ?? 1e9))   // 卡片永遠依犯人編號排序
    const liveMemberIds = new Set(inmatesLive.map(m => m.member_id))
    // 本場犯人 = 已入場 ∪ 未取消預約(尚未入場的以 booking 呈現)
    const bookingInmates = bk.filter(b => b.status !== 'cancelled' && !(b.user_id && liveMemberIds.has(b.user_id)))
    const liveGuards = merged.filter(m => m.role_in_session === 'guard')
    const liveGuardIds = new Set(liveGuards.map(m => m.member_id))
    const onDutyGuards = sg.filter(r => !liveGuardIds.has(r.guard_id)).map(r => ({ guard_id: r.guard_id, profile: profById[r.guard_id] }))
    // 指派用獄卒名冊(供 GuardAssign):已入場獄卒 ∪ 當日排班(session_guards),統一為 { id, member_id, profile }
    const assignMap = new Map()
    for (const g of liveGuards) if (g.member_id) assignMap.set(g.member_id, { id: g.member_id, member_id: g.member_id, profile: g.profile })
    for (const r of sg) if (r.guard_id && !assignMap.has(r.guard_id)) assignMap.set(r.guard_id, { id: r.guard_id, member_id: r.guard_id, profile: profById[r.guard_id] })
    const assignRoster = [...assignMap.values()]
    setRosterById(prev => ({ ...prev, [sid]: { inmatesLive, bookingInmates, liveGuards, onDutyGuards, assignRoster, bookings: bk, profById, startTime: null } }))
  }

  // 預約犯人「DC 預約頻道建立」確認(樂觀更新 + 失敗回滾)。
  async function toggleDcChannel(sid, b) {
    const val = !b.dc_channel_ready
    setRosterById(prev => {
      const r = prev[sid]; if (!r) return prev
      return { ...prev, [sid]: { ...r, bookingInmates: r.bookingInmates.map(x => x.id === b.id ? { ...x, dc_channel_ready: val } : x) } }
    })
    const { error } = await supabase.from('bookings').update({ dc_channel_ready: val }).eq('id', b.id)
    if (error) { loadExpand(sid); setMsg('更新失敗：' + error.message); return }
    setMsg(val ? '已標記 DC 頻道建立' : '已取消 DC 頻道建立')
  }
  async function toggleExpand(s) {
    if (normalizeStatus(s) === 'ended') return
    if (expandedId === s.id) { setExpandedId(null); return }
    setExpandedId(s.id)
    if (rosterById[s.id]) return
    await loadExpand(s.id)
  }

  // 把上限輸入轉成 int 或 null(空白 / 非正整數 → null = 不限)
  const capValue = (v) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 ? n : null }
  // 時格數:正整數,上限 48(預設 4 = 兩小時)
  const slotValue = (v) => { const n = parseInt(v); return Number.isFinite(n) && n > 0 ? Math.min(n, 48) : 4 }

  async function openNew() {
    if (!newTitle) { setMsg('請填場次名'); return }
    const payload = { title: newTitle, is_public: newPublic, kind: newKind, total_rounds: 4 }   // 番茄鐘預設 4 輪
    if (newDate) payload.session_date = newDate
    payload.capacity = capValue(newCap)
    if (newKind === 'named') { payload.start_time = newStart || null; payload.slot_count = slotValue(newSlots) }
    const { data, error } = await supabase.from('sessions').insert(payload).select().single()
    if (error) { setMsg('開場失敗：' + error.message); return }
    setSessions(prev => [data, ...prev])   // 新場插入頂端,不整頁重抓
    setMsg('已開場：' + newTitle)
    // 通行密鑰:僅公開場可設(內部場本來就不在官網露出)
    const pwVal = newPublic ? newPw.trim() : ''
    if (pwVal) {
      const { error: pwErr } = await supabase.from('session_passwords').insert({ session_id: data.id, password: pwVal })
      if (pwErr) setMsg('已開場，但密鑰設定失敗：' + pwErr.message)
      else setPwById(prev => ({ ...prev, [data.id]: pwVal }))
    }
    setNewTitle(''); setNewDate(''); setNewCap(''); setNewPublic(true); setNewKind(DEFAULT_SESSION_KIND); setNewStart(''); setNewSlots('4'); setNewPw('')
    reloadShared()   // 背景同步共用清單
  }

  function startEdit(s) {
    setEditId(s.id); setEditTitle(s.title ?? ''); setEditDate(s.session_date ?? ''); setEditCap(s.capacity ?? '')
    setEditPublic(s.is_public !== false)   // 帶入現值(null/undefined 視為公開)
    setEditKind(s.kind ?? DEFAULT_SESSION_KIND)
    setEditStart(s.start_time ? String(s.start_time).slice(0, 5) : '')   // 'HH:MM:SS' → 'HH:MM'
    setEditSlots(String(s.slot_count ?? 4))
    setEditPw(pwById[s.id] ?? '')
  }
  function cancelEdit() { setEditId(null); setEditTitle(''); setEditDate(''); setEditCap(''); setEditPublic(true); setEditKind(DEFAULT_SESSION_KIND); setEditStart(''); setEditSlots('4'); setEditPw('') }

  async function saveEdit(id) {
    if (!editTitle) { setMsg('場次名不能空白'); return }
    const snapshot = sessions
    const patch = { title: editTitle, session_date: editDate || null, capacity: capValue(editCap), is_public: editPublic, kind: editKind }
    if (editKind === 'named') { patch.start_time = editStart || null; patch.slot_count = slotValue(editSlots) }
    const pwVal = editPublic ? editPw.trim() : ''   // 取消公開 = 一併移除密鑰
    setSessions(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x))   // 樂觀更新
    cancelEdit(); setMsg('已更新場次')
    const { error } = await supabase.from('sessions').update(patch).eq('id', id)
    if (error) { setSessions(snapshot); setMsg('編輯失敗，已還原：' + error.message); return }
    // 密鑰同步:有值 upsert、空值刪除(沒設過也可安全刪)
    const { error: pwErr } = pwVal
      ? await supabase.from('session_passwords').upsert({ session_id: id, password: pwVal })
      : await supabase.from('session_passwords').delete().eq('session_id', id)
    if (pwErr) setMsg('場次已更新，但密鑰設定失敗：' + pwErr.message)
    else setPwById(prev => { const n = { ...prev }; if (pwVal) n[id] = pwVal; else delete n[id]; return n })
    reloadShared()
  }

  // 場次五態狀態機:樂觀切換狀態,不重排;成功後背景同步共用資料。
  // confirmText 有值時先二次確認(結束服刑、退回入場用)。
  async function setStatus(s, newStatus, okMsg, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return
    const snapshot = sessions
    // 樂觀更新:就地把該場 status 改成目標值(不重排,卡片留原位)。
    // 本元件的標籤/按鈕都靠 normalizeStatus(s) 判斷,新值會直接反映;
    // 番茄鐘等 timer 副作用由後端處理,reloadShared 會同步共用清單。
    setSessions(prev => prev.map(x => x.id === s.id ? { ...x, status: newStatus } : x))
    setMsg(okMsg)
    const { error } = await supabase.rpc('set_session_status', { p_session: s.id, p_new_status: newStatus })
    if (error) {
      setSessions(snapshot)   // 失敗回滾
      setMsg('狀態更新失敗，已還原：' + error.message)
      return
    }
    // 「開始入場」成功後自動帶入預約名單(bookings → session_inmates / booking_goals → session_goals)。
    // 一律靠 RPC,不自行 insert;在別場未結束者會被跳過並回傳,逐筆提示。
    if (newStatus === 'intake') {
      const { data: skipped } = await supabase.rpc('materialize_session_bookings', { p_session: s.id })
      setMsg(materializeResultMsg(skipped))
      setRosterById(prev => { const n = { ...prev }; delete n[s.id]; return n })   // 失效快取,重新展開時重抓
    }
    reloadShared()   // 背景同步共用 sessions(ended 會從 SessionTab 下拉消失),不重抓本頁
  }

  // 自由入場 / 指名互動:開始入場即開始服刑(免第二次點)。依序 intake(帶入名單)→ serving,只用已知合法轉移。
  async function startServingDirect(s) {
    const snapshot = sessions
    setSessions(prev => prev.map(x => x.id === s.id ? { ...x, status: 'serving' } : x))
    setMsg('已開始服刑')
    const r1 = await supabase.rpc('set_session_status', { p_session: s.id, p_new_status: 'intake' })
    if (r1.error) { setSessions(snapshot); setMsg('開始失敗，已還原：' + r1.error.message); return }
    const { data: skipped } = await supabase.rpc('materialize_session_bookings', { p_session: s.id })
    const r2 = await supabase.rpc('set_session_status', { p_session: s.id, p_new_status: 'serving' })
    if (r2.error) { setSessions(snapshot); setMsg('開始服刑失敗，已還原：' + r2.error.message); return }
    setRosterById(prev => { const n = { ...prev }; delete n[s.id]; return n })   // 失效快取
    const skipMsg = materializeResultMsg(skipped)
    setMsg(skipMsg && skipMsg !== '已帶入預約名單' ? skipMsg : '已開始服刑')
    reloadShared()
  }

  // 依 normalizeStatus(s) 顯示對應狀態機按鈕(退回類用次要/危險色與正向鈕區隔)
  function statusButtons(s) {
    // 自由入場 / 指名互動無番茄鐘,開始入場即開始服刑(直接進 serving);集體維持 入場→服刑 兩段。
    const directServe = s.kind === 'free' || s.kind === 'named'
    const startBtn = directServe
      ? <button className="btn-sm btn-pri" onClick={() => startServingDirect(s)}>開始入場</button>
      : <button className="btn-sm btn-pri" onClick={() => setStatus(s, 'intake', '已開始入場')}>開始入場</button>
    switch (normalizeStatus(s)) {
      case 'booking':
        return (<>
          <button className="btn-sm" onClick={() => setStatus(s, 'booking_paused', '已停止預約')}>停止預約</button>
          {startBtn}
        </>)
      case 'booking_paused':
        return (<>
          <button className="btn-sm" onClick={() => setStatus(s, 'booking', '已恢復報名')}>恢復報名</button>
          {startBtn}
        </>)
      case 'intake':   // 一般只有集體場會停在此;free/named 若因舊資料落此也給開始服刑
        return (<>
          <button className="btn-sm btn-pri" onClick={() => setStatus(s, 'serving', '已開始服刑')}>開始服刑</button>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'booking_paused', '已退回停止預約')}>退回停止預約</button>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'booking', '已退回預約中')}>退回預約中</button>
        </>)
      case 'serving':
        return (<>
          <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'ended', '已結束服刑', '確定結束本場服刑？結束後不可重開')}>結束服刑</button>
          {directServe
            ? <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'booking', '已退回預約中', '將退回預約中，全場回到等待')}>退回預約中</button>
            : <button className="btn-sm btn-danger" onClick={() => setStatus(s, 'intake', '已退回入場', '將清掉番茄鐘計時、退回入場狀態，全場回到等待')}>退回入場（清番茄鐘）</button>}
        </>)
      default:   // ended:不顯示狀態機按鈕
        return <span className="muted">已結束</span>
    }
  }

  async function deleteSession(s) {
    if (!window.confirm(`確定刪除場次「${s.title}」？此動作無法復原，本場名單與目標也會一併移除`)) return
    const snapshot = sessions
    setSessions(prev => prev.filter(x => x.id !== s.id))   // 樂觀移除
    if (expandedId === s.id) setExpandedId(null)           // 收掉可能展開中的該場
    setMsg('已刪除場次')
    const { error } = await supabase.from('sessions').delete().eq('id', s.id)
    if (error) { setSessions(snapshot); setMsg('刪除失敗，已還原：' + error.message); return }
    reloadShared()
  }

  return (
    <div>
      <h3>場次總覽</h3>

      {/* 開新場次(重用開場流程) */}
      <div className="toolbar">
        <input className="inp" placeholder="場次名（如 6/14 晚場）" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
        <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
        <input type="number" min="1" placeholder="人數上限（留空＝不限）" value={newCap} onChange={e => setNewCap(e.target.value)} style={{ width: 160 }} />
        <select className="inp" value={newKind} onChange={e => setNewKind(e.target.value)} style={{ width: 130 }}>
          {SESSION_KINDS.map(k => <option key={k} value={k}>{SESSION_KIND_LABEL[k]}</option>)}
        </select>
        {newKind === 'named' && (<>
          <input type="time" value={newStart} onChange={e => setNewStart(e.target.value)} title="開始時間" />
          <input type="number" min="1" max="48" placeholder="時格數" value={newSlots} onChange={e => setNewSlots(e.target.value)} title="半小時時格數" style={{ width: 100 }} />
        </>)}
        <label><input type="checkbox" checked={newPublic} onChange={e => { setNewPublic(e.target.checked); if (!e.target.checked) setNewPw('') }} />對外公開</label>
        {/* 通行密鑰:僅對外公開可設;設了官網會顯示「密鑰入獄」,需輸入密鑰才能報名 */}
        <input className="inp" placeholder={newPublic ? '通行密鑰（留空＝不設）' : '內部場不可設密鑰'} value={newPw}
          disabled={!newPublic} onChange={e => setNewPw(e.target.value)} style={{ width: 170 }} />
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
                  <input type="number" min="1" placeholder="上限（留空＝不限）" value={editCap} onChange={e => setEditCap(e.target.value)} style={{ width: 130 }} />
                  <select className="inp" value={editKind} onChange={e => setEditKind(e.target.value)} style={{ width: 120 }}>
                    {SESSION_KINDS.map(k => <option key={k} value={k}>{SESSION_KIND_LABEL[k]}</option>)}
                  </select>
                  {editKind === 'named' && (<>
                    <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} title="開始時間" />
                    <input type="number" min="1" max="48" placeholder="時格數" value={editSlots} onChange={e => setEditSlots(e.target.value)} title="半小時時格數" style={{ width: 90 }} />
                  </>)}
                  <label><input type="checkbox" checked={editPublic} onChange={e => { setEditPublic(e.target.checked); if (!e.target.checked) setEditPw('') }} />對外公開</label>
                  <input className="inp" placeholder={editPublic ? '通行密鑰（留空＝不設）' : '內部場不可設密鑰'} value={editPw}
                    disabled={!editPublic} onChange={e => setEditPw(e.target.value)} style={{ width: 160 }} />
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
                  <span className="tag tag-pill" style={{ background: 'rgba(180,120,255,.14)', color: '#c2a3ff' }}>
                    {SESSION_KIND_LABEL[s.kind] ?? SESSION_KIND_LABEL[DEFAULT_SESSION_KIND]}</span>
                  <span className="tag tag-pill" style={!ended
                    ? { background: 'rgba(63,179,107,.15)', color: 'var(--ok)' }
                    : { background: 'rgba(255,255,255,.08)', color: 'var(--dim)' }}>
                    {SESSION_STATUS_LABEL[st] ?? st}</span>
                  <span className="tag tag-pill" style={s.is_public !== false
                    ? { background: 'rgba(245,197,24,.12)', color: 'var(--hazard)' }
                    : { background: 'rgba(255,255,255,.06)', color: 'var(--faint)' }}>
                    {s.is_public !== false ? '官網公開' : '內部場'}</span>
                  {/* 密鑰場標記:後台直接顯示密鑰內容,方便典獄長轉知 */}
                  {s.is_public !== false && pwById[s.id] && (
                    <span className="tag tag-pill" style={{ background: 'rgba(63,140,255,.14)', color: '#7fb0ff' }}>
                      密鑰：{pwById[s.id]}</span>
                  )}
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
                  {/* 指名/集體場:當日上班獄卒排班(named 另可設可指名時格;crunch 只勾上班供指定監督)。預約頁據此顯示可指名/監督清單 */}
                  {(s.kind === 'named' || s.kind === 'crunch') && (
                    <SessionGuardPlan sessionId={s.id} staff={staffPool} kind={s.kind}
                      slotCount={s.slot_count ?? 4} startTime={s.start_time} setMsg={setMsg} />
                  )}
                  {!roster ? <p className="empty">讀取本場名單中…</p> : (<>
                    <div className="group-lbl">本場犯人 ({roster.inmatesLive.length + roster.bookingInmates.length})<span className="ln" /></div>
                    {(roster.inmatesLive.length + roster.bookingInmates.length) === 0 ? <p className="empty">本場沒有犯人</p> : (<>
                      {roster.inmatesLive.map(r => (
                        <div key={r.id} className="inmate">
                          <div className="in-av">{r.profile?.avatar_url ? <img src={r.profile.avatar_url} alt="" /> : (r.profile?.game_name ?? r.profile?.display_name ?? '?')[0]}</div>
                          <div>
                            <div className="in-nm">{r.profile?.game_name ?? r.profile?.display_name ?? '（未知）'} <span className="tag tag-pill" style={{ background: 'rgba(63,179,107,.15)', color: 'var(--ok)' }}>已入場</span></div>
                            <div className="in-no">No.{r.profile?.inmate_no != null ? String(r.profile.inmate_no).padStart(4, '0') : '----'}</div>
                          </div>
                          <span className="spacer" />
                          <GuardAssign sessionInmateId={r.id} guardRoster={roster.assignRoster} setMsg={setMsg} />
                        </div>
                      ))}
                      {roster.bookingInmates.map(b => {
                        const gname = id => roster.profById?.[id]?.game_name ?? roster.profById?.[id]?.display_name ?? '獄卒'
                        const picks = arr(b.requested_slots)
                        const addons = arr(b.addons).filter(a => a && (a.polaroid > 0 || a.sign))
                        const cap = b.capture && typeof b.capture === 'object' ? b.capture : null
                        return (
                          <div key={b.id} className="inmate" style={{ alignItems: 'flex-start' }}>
                            <div className="in-av">{b.avatar_url ? <img src={b.avatar_url} alt="" /> : (b.game_name ?? b.dc_name ?? '?')[0]}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="in-nm">{b.game_name ?? b.dc_name ?? '（未填暱稱）'} <span className="tag tag-pill" style={{ background: 'rgba(224,176,74,.16)', color: '#e0b04a' }}>{b.status === 'confirmed' ? '已確認' : '預約中'}</span>{!b.user_id && <span className="tag tag-pill" style={{ background: 'rgba(255,255,255,.1)', color: 'var(--dim)' }}>訪客</span>}</div>
                              <div className="in-no faint" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                {picks.length === 0 && addons.length === 0 && !cap && <span>尚未入場 · 無指名/加購</span>}
                                {picks.map((p, i) => <span key={i} className="tag tag-pill" style={{ background: 'rgba(180,120,255,.16)', color: '#c2a3ff' }}>{gname(p.g)}{p.s != null ? `（${slotLabel(s.start_time, p.s)}）` : '（監督）'}</span>)}
                                {addons.map((a, i) => <span key={'a' + i} className="tag tag-pill" style={{ background: 'rgba(63,140,255,.14)', color: '#7fb0ff' }}>{gname(a.g)}：拍立得 {a.polaroid || 0}{a.sign ? '＋簽繪' : ''}</span>)}
                                {cap && <span className="tag tag-pill" style={{ background: 'rgba(216,65,47,.14)', color: '#e88' }}>抓捕：委託 {cap.client || '?'} → {cap.target || '?'}{cap.targetServer ? `（${cap.targetServer}）` : ''}{cap.target_no != null ? ` · No.${String(cap.target_no).padStart(4, '0')}` : ''}{cap.guards ? ` · ${cap.guards} 位` : ''}</span>}
                              </div>
                              {/* 集體趕稿:走查/預約犯人也可由典獄長分配專屬獄卒(綁 booking) */}
                              {s.kind === 'crunch' && (
                                <div style={{ marginTop: 8 }}>
                                  <GuardAssign bookingId={b.id} guardRoster={roster.assignRoster} setMsg={setMsg} />
                                </div>
                              )}
                            </div>
                            <label className="gp-polaroid" style={{ flex: '0 0 auto' }}>
                              <input type="checkbox" checked={!!b.dc_channel_ready} onChange={() => toggleDcChannel(s.id, b)} />DC 頻道建立
                            </label>
                          </div>
                        )
                      })}
                    </>)}
                    {/* 本場獄卒改由「獄卒排班」直接檢視,此處不再重複顯示 */}
                  </>)}
                </div>
              )}
            </div>
          )})}
    </div>
  )
}
