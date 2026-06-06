import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { ProgressBar } from '../ManuscriptManager'
import { ROLE_LABEL } from './constants'
import SessionTimerControl from './SessionTimerControl'

export default function SessionTab({ currentSession, setCurrentSession, sessions, inmates, isWarden, setMsg, reloadShared }) {
  const [roster, setRoster] = useState([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [search, setSearch] = useState('')                 // 候選清單搜尋(名字/編號)
  const [selected, setSelected] = useState(new Set())      // 勾選批次加入的 member_id
  const [goalsByInmate, setGoalsByInmate] = useState({}) // session_inmate_id -> [{id, manuscript_id, title}]
  const [msByMember, setMsByMember] = useState({})       // member_id -> [active manuscripts]
  const [goalSteps, setGoalSteps] = useState({})         // manuscript_id -> [steps]
  const [pickGoal, setPickGoal] = useState({})           // session_inmate_id -> 選中的 manuscript_id
  const [goalExpanded, setGoalExpanded] = useState([])   // 展開中的目標(session_goals.id)
  const [assignedByInmate, setAssignedByInmate] = useState({}) // session_inmate_id -> [{id, guard_id, profile}]
  const [pickAssign, setPickAssign] = useState({})         // session_inmate_id -> 要指派的 guard member_id

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
      .select('id, member_id, title, status').in('member_id', memberIds)
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
      (gByInmate[g.session_inmate_id] ??= []).push({ ...g, title: msById[g.manuscript_id]?.title ?? '(未知稿件)' })
    const mByMember = {}
    for (const m of (ms ?? []).filter(x => x.status === 'active'))
      (mByMember[m.member_id] ??= []).push(m)
    const sBy = {}
    for (const s of steps) (sBy[s.manuscript_id] ??= []).push(s)
    setGoalsByInmate(gByInmate); setMsByMember(mByMember); setGoalSteps(sBy)
  }
  useEffect(() => { loadGoals(); loadAssignments() }, [roster])

  async function addInmateGoal(sessionInmateId) {
    const mid = pickGoal[sessionInmateId]
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

  // 載入本場犯人各自的專屬獄卒(分開查再合併)
  async function loadAssignments(rosterArg) {
    const rs = rosterArg ?? roster
    const inmateRows = rs.filter(r => r.role_in_session !== 'guard')
    if (!inmateRows.length) { setAssignedByInmate({}); return }
    const { data: igs } = await supabase.from('inmate_guards')
      .select('id, session_inmate_id, guard_id').in('session_inmate_id', inmateRows.map(r => r.id))
    const guardIds = [...new Set((igs ?? []).map(g => g.guard_id))]
    const gpById = {}
    if (guardIds.length) {
      const { data: gprofs } = await supabase.from('profiles')
        .select('id, game_name, display_name, avatar_url, role').in('id', guardIds)
      for (const p of gprofs ?? []) gpById[p.id] = p
    }
    const byInmate = {}
    for (const g of igs ?? [])
      (byInmate[g.session_inmate_id] ??= []).push({ id: g.id, guard_id: g.guard_id, profile: gpById[g.guard_id] })
    setAssignedByInmate(byInmate)
  }

  async function assignGuard(sessionInmateId) {
    const gid = pickAssign[sessionInmateId]
    if (!gid) return
    const { error } = await supabase.from('inmate_guards')
      .insert({ session_inmate_id: sessionInmateId, guard_id: gid })
    if (error) { setMsg('指派失敗:' + error.message); return }
    setPickAssign({ ...pickAssign, [sessionInmateId]: '' }); loadAssignments()
  }

  async function removeAssign(inmateGuardId) {
    const { error } = await supabase.from('inmate_guards').delete().eq('id', inmateGuardId)
    if (error) { setMsg('移除指派失敗:' + error.message); return }
    loadAssignments()
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
        {/* 番茄鐘控台:吃一個 session 的獨立元件,渲染為控制條的番茄鐘 .seg + 開始服刑 .go。
            key={session.id} 讓切換場次時內部狀態(輪數輸入等)自動重置。 */}
        {currentSessionObj && (
          <SessionTimerControl key={currentSessionObj.id} session={currentSessionObj}
            setMsg={setMsg} reloadShared={reloadShared} />
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
              const goalIds = goals.map(g => g.manuscript_id)
              const available = (msByMember[r.member_id] ?? []).filter(m => !goalIds.includes(m.id))
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
                          const done = steps.filter(s => s.done).length
                          const isOpen = goalExpanded.includes(g.id)
                          return (
                            <div key={g.id}>
                              <div className="detail-row">
                                <span style={{ flex: '0 0 130px', fontSize: 14 }}>{g.title}</span>
                                <div style={{ flex: 1, minWidth: 120 }}><ProgressBar done={done} total={steps.length} /></div>
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
                          <select className="sel" value={pickGoal[r.id] ?? ''} onChange={e => setPickGoal({ ...pickGoal, [r.id]: e.target.value })}>
                            <option value="">— 加一本稿進本場 —</option>
                            {available.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                          </select>
                          <button className="btn-sm" onClick={() => addInmateGoal(r.id)}>加入</button>
                          {available.length === 0 && <span className="faint">(此人沒有可加的 active 稿件)</span>}
                        </div>
                      </div>
                    </div>

                    {isWarden && (
                      <div className="detail-row" style={{ alignItems: 'flex-start' }}>
                        <span className="k">專屬獄卒</span>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {(assignedByInmate[r.id] ?? []).length === 0
                              ? <span className="v">未指派</span>
                              : (assignedByInmate[r.id] ?? []).map(a => (
                                <span key={a.id} className="tag tag-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(63,179,107,.12)', color: 'var(--ok)' }}>
                                  {a.profile?.role === 'warden' ? '典獄長' : '獄卒'}·{a.profile?.game_name ?? a.profile?.display_name ?? '?'}
                                  <button onClick={() => removeAssign(a.id)} style={{ border: 'none', background: 'none', color: 'inherit', padding: 0, minHeight: 'auto' }}>✕</button>
                                </span>
                              ))}
                          </div>
                          <div className="detail-row">
                            <select className="sel" value={pickAssign[r.id] ?? ''} onChange={e => setPickAssign({ ...pickAssign, [r.id]: e.target.value })}>
                              <option value="">— 指派專屬獄卒 —</option>
                              {guardRoster.filter(g => !(assignedByInmate[r.id] ?? []).some(a => a.guard_id === g.member_id))
                                .map(g => <option key={g.id} value={g.member_id}>{g.profile?.game_name ?? g.profile?.display_name}</option>)}
                            </select>
                            <button className="btn-sm" onClick={() => assignGuard(r.id)}>指派</button>
                            {guardRoster.length === 0 && <span className="faint">(本場尚無獄卒可指派)</span>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

              <div className="group-lbl">本場獄卒 ({guardRoster.length})<span className="ln" /></div>
              {guardRoster.length === 0 ? <p className="empty">本場沒有獄卒</p> : guardRoster.map(r => (
                <div key={r.id} className="member guard-member">
                  <div className="m-top">
                    <div className="avatar guard-av">
                      {r.profile?.avatar_url
                        ? <img src={r.profile.avatar_url} alt="" />
                        : (r.profile?.game_name ?? r.profile?.display_name ?? '?')[0]}
                    </div>
                    <div className="m-nm">
                      {r.profile?.game_name ?? r.profile?.display_name}
                      <span className="role-tag guard">{r.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                    </div>
                    <button className="btn-danger btn-sm spacer" onClick={() => removeFromSession(r.id)}>移出本場</button>
                  </div>
                </div>
              ))}
              </>)
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
