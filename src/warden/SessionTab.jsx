import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { ProgressBar } from '../ManuscriptManager'
import { computeProgress } from '../progress'
import { ROLE_LABEL, normalizeStatus } from './constants'
import SessionTimerControl from './SessionTimerControl'
import GuardAssign from './GuardAssign'

// 非 serving 狀態時,控制條番茄鐘區的提示(實際狀態機按鈕在「場次總覽」分頁)
const TIMER_HINT = {
  booking: '場次預約中,尚未開始入場',
  booking_paused: '已停止預約,尚未開始入場',
  intake: '已開始入場,於「場次總覽」按『開始服刑』啟動番茄鐘',
  ended: '本場已結束',
}

export default function SessionTab({ currentSession, setCurrentSession, sessions, inmates, isWarden, setMsg, reloadShared, onGoToManuscripts }) {
  const [roster, setRoster] = useState([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [search, setSearch] = useState('')                 // 候選清單搜尋(名字/編號)
  const [selected, setSelected] = useState(new Set())      // 勾選批次加入的 member_id
  const [goalsByInmate, setGoalsByInmate] = useState({}) // session_inmate_id -> [{id, manuscript_id, title}]
  const [msByMember, setMsByMember] = useState({})       // member_id -> [active manuscripts]
  const [goalSteps, setGoalSteps] = useState({})         // manuscript_id -> [steps]
  const [pickGoal, setPickGoal] = useState({})           // session_inmate_id -> 選中的 manuscript_id
  const [goalModalInmate, setGoalModalInmate] = useState(null) // 開啟「新增本場目標」modal 的犯人 roster row(null=關閉)
  const [goalExpanded, setGoalExpanded] = useState([])   // 展開中的目標(session_goals.id)
  const [visits, setVisits] = useState([])               // 本場探監(新→舊)
  const [vForm, setVForm] = useState({ inmate_id: '', visitor_name: '', message: '' }) // 探監登錄表單
  const [editingVisit, setEditingVisit] = useState(null) // inline 編輯中的探監 {id, visitor_name, message}

  async function loadRoster(sid) {
    if (!sid) { setRoster([]); return }
    setRosterLoading(true)
    const { data: si } = await supabase.from('session_inmates')
      .select('id, state, member_id, role_in_session').eq('session_id', sid)
    if (!si || si.length === 0) { setRoster([]); setRosterLoading(false); return }
    const ids = si.map(r => r.member_id)
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', ids)
    const merged = si.map(r => ({
      ...r,
      profile: (profs ?? []).find(p => p.id === r.member_id)
    }))
    setRoster(merged); setRosterLoading(false)
  }
  useEffect(() => { loadRoster(currentSession) }, [currentSession])

  // 載入本場每個犯人的「本場目標」+ 各自 active 稿件 + 目標稿件的子項目(算進度)
  async function loadGoals(rosterArg) {
    const rs = rosterArg ?? roster
    if (!rs.length) { setGoalsByInmate({}); setMsByMember({}); setGoalSteps({}); return }
    const inmateIds = rs.map(r => r.id)
    const memberIds = rs.map(r => r.member_id)
    const { data: goals } = await supabase.from('session_goals')
      .select('id, session_inmate_id, manuscript_id').in('session_inmate_id', inmateIds)
    const { data: ms } = await supabase.from('manuscripts')
      .select('id, member_id, title, status, is_done').in('member_id', memberIds)
    const msById = {}; for (const m of ms ?? []) msById[m.id] = m
    const goalMsIds = (goals ?? []).map(g => g.manuscript_id)
    let steps = []
    if (goalMsIds.length) {
      const { data: st } = await supabase.from('manuscript_steps')
        .select('id, manuscript_id, title, done, sort_order')
        .in('manuscript_id', goalMsIds).order('sort_order').order('created_at')
      steps = st ?? []
    }
    const gByInmate = {}
    for (const g of goals ?? [])
      (gByInmate[g.session_inmate_id] ??= []).push({ ...g, title: msById[g.manuscript_id]?.title ?? '(未知稿件)', is_done: msById[g.manuscript_id]?.is_done })
    const mByMember = {}
    for (const m of (ms ?? []).filter(x => x.status === 'active'))
      (mByMember[m.member_id] ??= []).push(m)
    const sBy = {}
    for (const s of steps) (sBy[s.manuscript_id] ??= []).push(s)
    setGoalsByInmate(gByInmate); setMsByMember(mByMember); setGoalSteps(sBy)
  }
  useEffect(() => { loadGoals() }, [roster])

  // 本場探監(visits);供 add/edit/delete 後手動刷新
  async function loadVisits(sid) {
    if (!sid) return
    const { data } = await supabase.from('visits')
      .select('id, inmate_id, visitor_name, message, created_at')
      .eq('session_id', sid).order('created_at', { ascending: false })
    setVisits(data ?? [])
  }
  // 切換場次時載入(IIFE:setState 皆在 await 後,避免 effect 同步 setState)
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!currentSession) return
      const { data } = await supabase.from('visits')
        .select('id, inmate_id, visitor_name, message, created_at')
        .eq('session_id', currentSession).order('created_at', { ascending: false })
      if (alive) setVisits(data ?? [])
    })()
    return () => { alive = false }
  }, [currentSession])

  async function addVisit() {
    if (!vForm.inmate_id || !vForm.visitor_name.trim() || !vForm.message.trim()) {
      setMsg('請選擇犯人、填寫探監者與廣播內容'); return
    }
    const { error } = await supabase.from('visits').insert({
      session_id: currentSession, inmate_id: vForm.inmate_id,
      visitor_name: vForm.visitor_name.trim(), message: vForm.message.trim(),
    })
    if (error) { setMsg('登錄探監失敗:' + error.message); return }
    setMsg('已登錄探監'); setVForm({ inmate_id: '', visitor_name: '', message: '' }); loadVisits(currentSession)
  }

  async function saveVisitEdit() {
    if (!editingVisit.visitor_name.trim() || !editingVisit.message.trim()) { setMsg('探監者與內容不可空白'); return }
    const { error } = await supabase.from('visits')
      .update({ visitor_name: editingVisit.visitor_name.trim(), message: editingVisit.message.trim() })
      .eq('id', editingVisit.id)   // updated_at 由觸發器自動更新
    if (error) { setMsg('更新探監失敗:' + error.message); return }
    setMsg('已更新探監'); setEditingVisit(null); loadVisits(currentSession)
  }

  async function deleteVisit(id) {
    if (!window.confirm('確定刪除這筆探監?')) return
    const { error } = await supabase.from('visits').delete().eq('id', id)
    if (error) { setMsg('刪除探監失敗:' + error.message); return }
    setMsg('已刪除探監'); loadVisits(currentSession)
  }

  async function addInmateGoal(sessionInmateId, manuscriptId) {
    const mid = manuscriptId ?? pickGoal[sessionInmateId]   // modal 直接帶稿件 id;沿用原下拉時讀 pickGoal
    if (!mid) return
    const { error } = await supabase.from('session_goals')
      .insert({ session_inmate_id: sessionInmateId, manuscript_id: mid })
    if (error) { setMsg('加入目標失敗:' + error.message); return }
    setPickGoal({ ...pickGoal, [sessionInmateId]: '' }); loadGoals()
  }

  async function removeInmateGoal(goalId) {
    const { error } = await supabase.from('session_goals').delete().eq('id', goalId)
    if (error) { setMsg('移除目標失敗:' + error.message); return }
    loadGoals()
  }

  function openBroadcast(sessionId) {
    window.open(window.location.origin + '/?broadcast=' + sessionId, '_blank', 'width=1280,height=720')
  }

  async function removeFromSession(sessionInmateId) {
    if (!window.confirm('確定將這位犯人移出本場?')) return
    const { error } = await supabase.from('session_inmates').delete().eq('id', sessionInmateId)
    if (error) { setMsg('移出失敗:' + error.message); return }
    setMsg('已移出本場'); loadRoster(currentSession)  // 本場目標靠 cascade 自動清
  }

  async function toggleGoalStep(step) {
    const next = !step.done
    const setDone = (val) => setGoalSteps(prev => {
      const arr = prev[step.manuscript_id] ?? []
      return { ...prev, [step.manuscript_id]: arr.map(s => s.id === step.id ? { ...s, done: val } : s) }
    })
    // 1) 樂觀更新:先改本地 state,進度條立即重算
    setDone(next)
    // 2) 背景寫 DB;失敗則回滾畫面並提示(避免畫面與 DB 不一致)
    const { error } = await supabase.from('manuscript_steps').update({ done: next }).eq('id', step.id)
    if (error) { setDone(step.done); setMsg('子項目更新失敗,已還原:' + error.message) }
  }

  function toggleGoalExpand(goalId) {
    setGoalExpanded(prev => prev.includes(goalId)
      ? prev.filter(x => x !== goalId)
      : [...prev, goalId])
  }

  // 報到成獄卒前,該人全域 role 必須是 guard / warden
  const canBeGuard = (p) => p?.role === 'guard' || p?.role === 'warden'

  function toggleOne(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // 一鍵加入(沿用 check_in_inmate;非獄卒資格者不會出現「+ 本場獄卒」鈕)
  async function addOne(p, roleInSession) {
    const { error } = await supabase.rpc('check_in_inmate', {
      p_session: currentSession, p_member: p.id, p_role_in_session: roleInSession,
    })
    if (error) { setMsg('加入失敗:' + error.message); return }
    setMsg(roleInSession === 'guard' ? '已加入(本場獄卒)' : '已加入(本場犯人)')
    setSelected(prev => { const n = new Set(prev); n.delete(p.id); return n })
    loadRoster(currentSession)
  }

  // 批次加入:犯人全加;獄卒只加全域 guard/warden,其餘跳過並提示
  async function addBatch(roleInSession) {
    const chosen = candidates.filter(p => selected.has(p.id))
    if (!chosen.length) return
    const toAdd = roleInSession === 'guard' ? chosen.filter(canBeGuard) : chosen
    const skipped = chosen.length - toAdd.length
    let ok = 0, failed = 0
    for (const p of toAdd) {
      const { error } = await supabase.rpc('check_in_inmate', {
        p_session: currentSession, p_member: p.id, p_role_in_session: roleInSession,
      })
      if (error) failed++; else ok++
    }
    let m = `已加入 ${ok} 人為本場${roleInSession === 'guard' ? '獄卒' : '犯人'}`
    if (skipped) m += `;${skipped} 人因全域身分不符,未加為獄卒`
    if (failed) m += `;${failed} 人加入失敗`
    setMsg(m)
    setSelected(new Set()); loadRoster(currentSession)
  }

  const rosterIds = roster.map(r => r.member_id)
  const availableInmates = inmates.filter(p => !rosterIds.includes(p.id))
  // 候選清單 = 已配號且未在本場的人,再依搜尋(名字/編號)前端 filter
  const q = search.trim().toLowerCase()
  const candidates = availableInmates.filter(p => {
    if (!q) return true
    const name = (p.game_name ?? p.display_name ?? '').toLowerCase()
    return name.includes(q) || String(p.inmate_no ?? '').includes(q) || String(p.inmate_no ?? '').padStart(4, '0').includes(q)
  })
  const selectedInView = candidates.filter(p => selected.has(p.id))
  const allSelected = candidates.length > 0 && candidates.every(p => selected.has(p.id))
  function toggleAll() {
    setSelected(prev => {
      const n = new Set(prev)
      if (candidates.every(p => prev.has(p.id))) candidates.forEach(p => n.delete(p.id))
      else candidates.forEach(p => n.add(p.id))
      return n
    })
  }
  const currentSessionObj = sessions.find(s => s.id === currentSession)
  // 探監用:本場犯人(下拉選項)+ member_id → profile(列表顯示犯人名)
  const inmateRoster = roster.filter(r => r.role_in_session !== 'guard')
  const profByMember = {}; for (const r of roster) profByMember[r.member_id] = r.profile

  return (
    <div>
      {/* 場次控制條:目前場次 / 直播大螢幕 / 番茄鐘 / 開始服刑(開新場次移至「場次總覽」) */}
      <div className="control">
        <div className="seg">
          <span className="lbl">目前場次</span>
          <div className="row">
            <select className="sel" value={currentSession} onChange={e => setCurrentSession(e.target.value)}>
              <option value="">— 選擇場次 —</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>
        <div className="seg">
          <span className="lbl">直播大螢幕</span>
          <div className="row broadcast-list">
            {sessions.length === 0
              ? <span className="muted">無開放場次</span>
              : sessions.map(s => (
                <button key={s.id} className="btn-sm" onClick={() => openBroadcast(s.id)}>📺 {s.title} ↗</button>
              ))}
          </div>
        </div>
        {/* 番茄鐘控台:只有場次 = serving 時才有意義(計時資料),故只在 serving 渲染。
            其餘狀態在此顯示提示,實際狀態機操作在「場次總覽」分頁。
            key={session.id} 讓切換場次時內部狀態(輪數輸入等)自動重置。 */}
        {currentSessionObj && (
          normalizeStatus(currentSessionObj) === 'serving'
            ? <SessionTimerControl key={currentSessionObj.id} session={currentSessionObj}
                setMsg={setMsg} reloadShared={reloadShared} />
            : <div className="seg">
                <span className="lbl">番茄鐘</span>
                <div className="row timer-state"><span className="muted">{TIMER_HINT[normalizeStatus(currentSessionObj)] ?? '本場尚未開始服刑'}</span></div>
              </div>
        )}
      </div>

      {/* 左右兩欄:左=加入本場候選清單,右=本場名單 */}
      <div className="cols">
        {/* 左:候選清單 */}
        <div className="card-panel">
          <div className="head"><h2>加入本場</h2><span className="count">候選清單</span></div>
          <div className="body">
            {!currentSession ? (
              <p className="empty">請先在上方選擇目前場次</p>
            ) : (<>
              <div className="cand-tools">
                <input className="inp" placeholder="搜尋名字 / 編號" value={search} onChange={e => setSearch(e.target.value)} />
                {candidates.length > 0 && (
                  <button onClick={toggleAll}>{allSelected ? '取消全選' : '全選'}</button>
                )}
              </div>

              {selectedInView.length > 0 && (
                <div className="cand-batch">
                  <span>已選 {selectedInView.length} 人 →</span>
                  <button className="btn-sm" onClick={() => addBatch('inmate')}>加入為本場犯人</button>
                  <button className="btn-sm" onClick={() => addBatch('guard')}>加入為本場獄卒</button>
                </div>
              )}

              {candidates.length === 0 ? (
                <p className="empty">沒有可加入的人(已配號的人都在本場了,或搜尋無結果)</p>
              ) : candidates.map(p => {
                const guardOk = canBeGuard(p)
                return (
                  <div key={p.id} className="cand">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} />
                    <span className="id">No.{String(p.inmate_no).padStart(4, '0')}</span>
                    <span className="nm">{p.game_name ?? p.display_name}</span>
                    {guardOk && <span className={`role-tag ${p.role}`}>{ROLE_LABEL[p.role]}</span>}
                    <span className="acts">
                      <button onClick={() => addOne(p, 'inmate')}>+犯人</button>
                      {guardOk && <button onClick={() => addOne(p, 'guard')}>+獄卒</button>}
                    </span>
                  </div>
                )
              })}
              <div className="note">勾選多人後可批次「加入本場」;單筆直接點右側 +犯人 / +獄卒。</div>
            </>)}
          </div>
        </div>

        {/* 右:本場名單 */}
        <div className="card-panel">
          <div className="head"><h2>本場名單</h2></div>
          <div className="body">
            {rosterLoading ? <p className="empty">載入中…</p>
              : roster.length === 0 ? <p className="empty">本場還沒有人</p> : (() => {
              const inmateRoster = roster.filter(r => r.role_in_session !== 'guard')
              const guardRoster = roster.filter(r => r.role_in_session === 'guard')
              return (<>
              <div className="group-lbl">本場犯人 ({inmateRoster.length})<span className="ln" /></div>
              {inmateRoster.length === 0 ? <p className="empty">本場沒有犯人</p> : inmateRoster.map(r => {
              const goals = goalsByInmate[r.id] ?? []
              const avInit = r.profile?.inmate_no != null ? String(r.profile.inmate_no).padStart(2, '0').slice(-2) : (r.profile?.game_name ?? '?')[0]
              return (
                <div key={r.id} className="member">
                  <div className="m-top">
                    <div className="avatar">{avInit}</div>
                    <div>
                      <div className="m-id">No.{String(r.profile?.inmate_no).padStart(4, '0')}</div>
                      <div className="m-nm">{r.profile?.game_name ?? r.profile?.display_name} <span className="faint">（{r.state}）</span></div>
                    </div>
                    <button className="btn-danger btn-sm spacer" onClick={() => removeFromSession(r.id)}>移出本場</button>
                  </div>
                  <div className="m-detail">
                    {/* 本場目標 */}
                    <div className="detail-row" style={{ alignItems: 'flex-start' }}>
                      <span className="k">本場目標</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {goals.length === 0 ? <span className="v">尚未挑選</span> : goals.map(g => {
                          const steps = goalSteps[g.manuscript_id] ?? []
                          const prog = computeProgress({ steps, isDone: g.is_done })
                          const isOpen = goalExpanded.includes(g.id)
                          return (
                            <div key={g.id}>
                              <div className="detail-row">
                                <span style={{ flex: '0 0 130px', fontSize: 14 }}>{g.title}</span>
                                <div style={{ flex: 1, minWidth: 120 }}><ProgressBar progress={prog} /></div>
                                <button className="btn-sm" onClick={() => toggleGoalExpand(g.id)}>{isOpen ? '收合' : '展開'}</button>
                                <button className="btn-sm btn-danger" onClick={() => removeInmateGoal(g.id)}>移除</button>
                              </div>
                              {isOpen && (
                                <div className="substeps">
                                  {steps.length === 0 ? (
                                    <p className="empty">這本稿還沒有子項目</p>
                                  ) : steps.map(s => (
                                    <div key={s.id} className="step">
                                      <input type="checkbox" checked={s.done} onChange={() => toggleGoalStep(s)} />
                                      <span className={s.done ? 'done-text' : ''}>{s.title}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        <div className="detail-row">
                          <button className="btn-sm" onClick={() => setGoalModalInmate(r)}>+ 新增本場目標</button>
                        </div>
                      </div>
                    </div>

                    {isWarden && (
                      <div className="detail-row" style={{ alignItems: 'flex-start' }}>
                        <span className="k">專屬獄卒</span>
                        <GuardAssign sessionInmateId={r.id} guardRoster={guardRoster} setMsg={setMsg} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

              <div className="group-lbl">本場獄卒 ({guardRoster.length})<span className="ln" /></div>
              {guardRoster.length === 0 ? <p className="empty">本場沒有獄卒</p> : (
                <div className="guard-grid">
                  {guardRoster.map(r => (
                    <div key={r.id} className="guard-cell">
                      <button className="g-x btn-danger" title="移出本場" onClick={() => removeFromSession(r.id)}>✕</button>
                      <div className="g-av">
                        {r.profile?.avatar_url
                          ? <img src={r.profile.avatar_url} alt="" />
                          : (r.profile?.game_name ?? r.profile?.display_name ?? '?')[0]}
                      </div>
                      <div className="g-nm">{r.profile?.game_name ?? r.profile?.display_name}</div>
                      <span className="role-tag guard">{r.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                    </div>
                  ))}
                </div>
              )}
              </>)
            })()}
          </div>
        </div>
      </div>

      {/* 探監登錄(僅 warden;選本場犯人 + 探監者 + 廣播內容 → visits) */}
      {isWarden && currentSession && (
        <div className="card-panel visit-panel">
          <div className="head"><h2>探監登錄</h2><span className="count">{visits.length} 筆</span></div>
          <div className="body">
            <div className="visit-form">
              <select className="sel" value={vForm.inmate_id} onChange={e => setVForm({ ...vForm, inmate_id: e.target.value })}>
                <option value="">— 選擇犯人 —</option>
                {inmateRoster.map(r => (
                  <option key={r.id} value={r.member_id}>
                    No.{String(r.profile?.inmate_no ?? 0).padStart(4, '0')} {r.profile?.game_name ?? r.profile?.display_name ?? '?'}
                  </option>
                ))}
              </select>
              <input className="inp" placeholder="探監者名字" value={vForm.visitor_name}
                onChange={e => setVForm({ ...vForm, visitor_name: e.target.value })} />
              <div className="visit-msg-field">
                <textarea className="inp" rows={2} maxLength={80} placeholder="廣播內容(最多 80 字)"
                  value={vForm.message} onChange={e => setVForm({ ...vForm, message: e.target.value })} />
                <span className="visit-count">{vForm.message.length} / 80</span>
              </div>
              <button className="btn-pri" onClick={addVisit}>送出探監</button>
            </div>

            {visits.length === 0 ? (
              <p className="empty">本場還沒有探監紀錄</p>
            ) : (
              <div className="visit-list">
                {visits.map(v => {
                  const ip = profByMember[v.inmate_id]
                  const inmateName = ip?.game_name ?? ip?.display_name ?? '(已離場)'
                  const isEditing = editingVisit?.id === v.id
                  return (
                    <div key={v.id} className="visit-row">
                      {isEditing ? (
                        <div className="visit-edit">
                          <input className="inp" placeholder="探監者" value={editingVisit.visitor_name}
                            onChange={e => setEditingVisit({ ...editingVisit, visitor_name: e.target.value })} />
                          <textarea className="inp" rows={2} maxLength={80} placeholder="內容" value={editingVisit.message}
                            onChange={e => setEditingVisit({ ...editingVisit, message: e.target.value })} />
                          <div className="visit-acts">
                            <button className="btn-sm" onClick={() => setEditingVisit(null)}>取消</button>
                            <button className="btn-sm btn-pri" onClick={saveVisitEdit}>儲存</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="visit-text">
                            <span className="visit-who">💌 {v.visitor_name} → No.{ip?.inmate_no != null ? String(ip.inmate_no).padStart(4, '0') : '----'} {inmateName}</span>
                            <span className="visit-body">「{v.message}」</span>
                          </div>
                          <span className="spacer" />
                          <div className="visit-acts">
                            <button className="btn-sm" onClick={() => setEditingVisit({ id: v.id, visitor_name: v.visitor_name, message: v.message })}>編輯</button>
                            <button className="btn-sm btn-danger" onClick={() => deleteVisit(v.id)}>刪除</button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 新增本場目標 modal:把原本 inline 挑稿清單搬進 modal,挑稿沿用 addInmateGoal,可連續挑多筆。
          可挑清單即時依 goalsByInmate/msByMember 重算(挑進來的稿自動從清單移除)。 */}
      {goalModalInmate && (() => {
        const r = goalModalInmate
        const goalIds = (goalsByInmate[r.id] ?? []).map(g => g.manuscript_id)
        const available = (msByMember[r.member_id] ?? []).filter(m => !goalIds.includes(m.id))
        const name = r.profile?.game_name ?? r.profile?.display_name
        return (
          <div className="admin-modal-bg" onClick={() => setGoalModalInmate(null)}>
            <div className="admin-modal goal-modal" onClick={e => e.stopPropagation()}>
              <div className="goal-modal-head">
                <h3>新增本場目標 · {name}</h3>
                <button className="goal-modal-x" onClick={() => setGoalModalInmate(null)}>✕</button>
              </div>
              {available.length === 0 ? (
                <div className="goal-modal-empty">
                  <p className="warn">沒有可挑的 active 稿件(都挑進來了,或先到「我的稿件」新增)</p>
                  {onGoToManuscripts && (
                    <button className="btn-pri" onClick={() => { setGoalModalInmate(null); onGoToManuscripts() }}>前往我的稿件</button>
                  )}
                </div>
              ) : (
                <div className="goal-pick-list">
                  {available.map(m => (
                    <button key={m.id} className="goal-pick" onClick={() => addInmateGoal(r.id, m.id)}>
                      <span className="goal-pick-title">{m.title}</span>
                      <span className="goal-pick-add">＋ 加入</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
