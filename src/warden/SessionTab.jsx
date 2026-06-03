import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { ProgressBar } from '../ManuscriptManager'
import { sessionPlan } from '../pomodoro'
import { ROLE_LABEL } from './constants'

export default function SessionTab({ currentSession, setCurrentSession, sessions, inmates, isWarden, setMsg, reloadShared }) {
  const [roster, setRoster] = useState([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('')
  const [pickInmate, setPickInmate] = useState('')
  const [pickRole, setPickRole] = useState('inmate')       // 報到時選的本場身分
  const [goalsByInmate, setGoalsByInmate] = useState({}) // session_inmate_id -> [{id, manuscript_id, title}]
  const [msByMember, setMsByMember] = useState({})       // member_id -> [active manuscripts]
  const [goalSteps, setGoalSteps] = useState({})         // manuscript_id -> [steps]
  const [pickGoal, setPickGoal] = useState({})           // session_inmate_id -> 選中的 manuscript_id
  const [goalExpanded, setGoalExpanded] = useState([])   // 展開中的目標(session_goals.id)
  const [roundsInput, setRoundsInput] = useState(8)      // 番茄鐘專注輪數輸入
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

  // 切換場次時,把輪數輸入同步成該場目前設定
  useEffect(() => {
    const cur = sessions.find(s => s.id === currentSession)
    if (cur) setRoundsInput(cur.total_rounds ?? 8)
  }, [currentSession, sessions])

  async function saveRounds() {
    const n = Math.max(1, parseInt(roundsInput) || 1)
    const { error } = await supabase.from('sessions').update({ total_rounds: n }).eq('id', currentSession)
    if (error) { setMsg('儲存輪數失敗:' + error.message); return }
    setMsg('已設定專注輪數:' + n); reloadShared()
  }

  async function startTimer() {
    const { error } = await supabase.from('sessions')
      .update({ timer_started_at: new Date().toISOString() }).eq('id', currentSession)
    if (error) { setMsg('開始失敗:' + error.message); return }
    setMsg('已開始服刑'); reloadShared()
  }

  async function resetTimer() {
    if (!window.confirm('確定重置番茄鐘?將清掉開始時間,全場回到等待狀態')) return
    const { error } = await supabase.from('sessions')
      .update({ timer_started_at: null }).eq('id', currentSession)
    if (error) { setMsg('重置失敗:' + error.message); return }
    setMsg('已重置番茄鐘'); reloadShared()
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

  async function openSession() {
    if (!sessionTitle) { setMsg('請填場次名'); return }
    const { data, error } = await supabase.from('sessions').insert({ title: sessionTitle }).select().single()
    if (error) { setMsg('開場失敗:' + error.message); return }
    setMsg('已開場:' + sessionTitle); setSessionTitle(''); setCurrentSession(data.id); reloadShared()
  }

  async function checkIn() {
    if (!currentSession || !pickInmate) { setMsg('請選場次和犯人'); return }
    // 只有 guard/warden 資格的人能被報到成本場獄卒;其餘一律本場犯人
    const picked = inmates.find(p => p.id === pickInmate)
    const canBeGuard = picked && (picked.role === 'guard' || picked.role === 'warden')
    const roleInSession = (pickRole === 'guard' && canBeGuard) ? 'guard' : 'inmate'
    // 一次原子寫入:報到 + 本場身分都在 RPC 內完成
    const { error } = await supabase.rpc('check_in_inmate', {
      p_session: currentSession, p_member: pickInmate, p_role_in_session: roleInSession,
    })
    if (error) { setMsg('報到失敗:' + error.message); return }
    setMsg(roleInSession === 'guard' ? '已報到(本場獄卒)' : '已報到(本場犯人)')
    setPickInmate(''); setPickRole('inmate'); loadRoster(currentSession)
  }

  const rosterIds = roster.map(r => r.member_id)
  const availableInmates = inmates.filter(p => !rosterIds.includes(p.id))
  const pickedProfile = inmates.find(p => p.id === pickInmate)
  const pickedCanBeGuard = pickedProfile && (pickedProfile.role === 'guard' || pickedProfile.role === 'warden')
  const currentSessionObj = sessions.find(s => s.id === currentSession)
  const plan = sessionPlan(Math.max(1, parseInt(roundsInput) || 1))

  return (
    <div>
      <h3>場次管理</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input placeholder="場次名(如 6/14 晚場)" value={sessionTitle} onChange={e => setSessionTitle(e.target.value)} />
        <button onClick={openSession}>開新場次</button>
      </div>
      <div style={{ marginBottom: 8 }}>
        目前場次:
        <select value={currentSession} onChange={e => setCurrentSession(e.target.value)} style={{ marginLeft: 6 }}>
          <option value="">— 選擇場次 —</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </div>
      {sessions.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: 13 }}>直播大螢幕:</span>
          {sessions.map(s => (
            <button key={s.id} onClick={() => openBroadcast(s.id)}
              style={{ padding: '2px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}>
              📺 {s.title}
            </button>
          ))}
        </div>
      )}
      {currentSession && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          報到:
          <select value={pickInmate} onChange={e => { setPickInmate(e.target.value); setPickRole('inmate') }}>
            <option value="">— 選人 —</option>
            {availableInmates.map(p => <option key={p.id} value={p.id}>
              No.{String(p.inmate_no).padStart(4, '0')} {p.game_name ?? p.display_name}{(p.role === 'guard' || p.role === 'warden') ? `（${ROLE_LABEL[p.role]}）` : ''}
            </option>)}
          </select>
          本場身分:
          <select value={pickedCanBeGuard ? pickRole : 'inmate'} disabled={!pickedCanBeGuard}
            onChange={e => setPickRole(e.target.value)}>
            <option value="inmate">本場犯人</option>
            {pickedCanBeGuard && <option value="guard">本場獄卒</option>}
          </select>
          <button onClick={checkIn}>報到進本場</button>
          {pickInmate && !pickedCanBeGuard && <span style={{ color: '#aaa', fontSize: 12 }}>(此人非獄卒資格,只能當本場犯人)</span>}
        </div>
      )}

      {currentSession && (
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8, background: '#fff', color: '#222' }}>
          <strong>番茄鐘控制</strong>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            專注輪數:
            <input type="number" min="1" value={roundsInput}
              onChange={e => setRoundsInput(e.target.value)}
              style={{ width: 64, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }} />
            <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}
              onClick={saveRounds}>儲存輪數</button>
            <span style={{ color: '#666', fontSize: 13 }}>
              預覽總時長:約 <strong>{plan.totalMinutes}</strong> 分(專注25×{plan.focusCount} + 放風5×{plan.normalBreakCount} + 長休15×{plan.longBreakCount})
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            {currentSessionObj?.timer_started_at ? (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: '#2a7' }}>● 已開始服刑</span>
                <span style={{ color: '#888', fontSize: 13 }}>開始於 {new Date(currentSessionObj.timer_started_at).toLocaleString()}</span>
                <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
                  onClick={resetTimer}>重置</button>
              </span>
            ) : (
              <button style={{ padding: '6px 16px', border: '1px solid #bbb', borderRadius: 4, background: '#eef4ff', color: '#333', cursor: 'pointer', fontWeight: 700 }}
                onClick={startTimer}>開始服刑</button>
            )}
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>本場名單</h3>
      {rosterLoading ? <p style={{ color: '#888' }}>載入中…</p>
        : roster.length === 0 ? <p style={{ color: '#888' }}>本場還沒有人</p> : (() => {
        const inmateRoster = roster.filter(r => r.role_in_session !== 'guard')
        const guardRoster = roster.filter(r => r.role_in_session === 'guard')
        return (<>
        <h4 style={{ margin: '8px 0', color: '#555' }}>本場犯人（{inmateRoster.length}）</h4>
        {inmateRoster.length === 0 ? <p style={{ color: '#888' }}>本場沒有犯人</p> : inmateRoster.map(r => {
        const goals = goalsByInmate[r.id] ?? []
        const goalIds = goals.map(g => g.manuscript_id)
        const available = (msByMember[r.member_id] ?? []).filter(m => !goalIds.includes(m.id))
        return (
          <div key={r.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fff', color: '#222' }}>
            <strong>No.{String(r.profile?.inmate_no).padStart(4, '0')} · {r.profile?.game_name ?? r.profile?.display_name}</strong>
            <span style={{ marginLeft: 8, color: '#888', fontSize: 13 }}>（{r.state}）</span>
            <button style={{ marginLeft: 10, padding: '2px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
              onClick={() => removeFromSession(r.id)}>移出本場</button>

            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 13, color: '#666' }}>本場目標:</span>
              {goals.length === 0 ? (
                <span style={{ color: '#aaa', fontSize: 13, marginLeft: 6 }}>尚未挑選</span>
              ) : goals.map(g => {
                const steps = goalSteps[g.manuscript_id] ?? []
                const done = steps.filter(s => s.done).length
                const isOpen = goalExpanded.includes(g.id)
                return (
                  <div key={g.id} style={{ margin: '6px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: '0 0 140px', fontSize: 14 }}>{g.title}</span>
                      <div style={{ flex: 1 }}><ProgressBar done={done} total={steps.length} /></div>
                      <button style={{ padding: '2px 8px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}
                        onClick={() => toggleGoalExpand(g.id)}>{isOpen ? '收合' : '展開'}</button>
                      <button style={{ padding: '2px 8px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
                        onClick={() => removeInmateGoal(g.id)}>移除</button>
                    </div>
                    {isOpen && (
                      <div style={{ margin: '6px 0 6px 12px', paddingLeft: 12, borderLeft: '2px solid #eee' }}>
                        {steps.length === 0 ? (
                          <p style={{ color: '#999', fontSize: 13, margin: 0 }}>這本稿還沒有子項目</p>
                        ) : steps.map(s => (
                          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <input type="checkbox" checked={s.done} onChange={() => toggleGoalStep(s)} />
                            <span style={{ fontSize: 14, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? '#999' : '#222' }}>{s.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }}
                value={pickGoal[r.id] ?? ''} onChange={e => setPickGoal({ ...pickGoal, [r.id]: e.target.value })}>
                <option value="">— 加一本稿進本場 —</option>
                {available.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <button style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#eef4ff', color: '#333', cursor: 'pointer' }}
                onClick={() => addInmateGoal(r.id)}>加入</button>
              {available.length === 0 && <span style={{ color: '#aaa', fontSize: 12 }}>(此人沒有可加的 active 稿件)</span>}
            </div>

            {isWarden && (
              <div style={{ marginTop: 8, borderTop: '1px dashed #eee', paddingTop: 8 }}>
                <span style={{ fontSize: 13, color: '#666' }}>專屬獄卒:</span>
                {(assignedByInmate[r.id] ?? []).length === 0
                  ? <span style={{ color: '#aaa', fontSize: 13, marginLeft: 6 }}>未指派</span>
                  : (assignedByInmate[r.id] ?? []).map(a => (
                    <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, fontSize: 13, padding: '2px 8px', borderRadius: 12, background: '#fff7ec' }}>
                      {a.profile?.role === 'warden' ? '典獄長' : '獄卒'}·{a.profile?.game_name ?? a.profile?.display_name ?? '?'}
                      <button onClick={() => removeAssign(a.id)} style={{ border: 'none', background: 'none', color: '#c00', cursor: 'pointer', padding: 0 }}>✕</button>
                    </span>
                  ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={pickAssign[r.id] ?? ''} onChange={e => setPickAssign({ ...pickAssign, [r.id]: e.target.value })}
                    style={{ padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }}>
                    <option value="">— 指派專屬獄卒 —</option>
                    {guardRoster.filter(g => !(assignedByInmate[r.id] ?? []).some(a => a.guard_id === g.member_id))
                      .map(g => <option key={g.id} value={g.member_id}>{g.profile?.game_name ?? g.profile?.display_name}</option>)}
                  </select>
                  <button onClick={() => assignGuard(r.id)} style={{ padding: '4px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#eef4ff', color: '#333', cursor: 'pointer' }}>指派</button>
                  {guardRoster.length === 0 && <span style={{ color: '#aaa', fontSize: 12 }}>(本場尚無獄卒可指派)</span>}
                </div>
              </div>
            )}
          </div>
        )
      })}

        <h4 style={{ margin: '16px 0 8px', color: '#555' }}>本場獄卒（{guardRoster.length}）</h4>
        {guardRoster.length === 0 ? <p style={{ color: '#888' }}>本場沒有獄卒</p> : guardRoster.map(r => (
          <div key={r.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fff7ec', color: '#222', display: 'flex', alignItems: 'center', gap: 10 }}>
            {r.profile?.avatar_url
              ? <img src={r.profile.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
              : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e08e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(r.profile?.game_name ?? r.profile?.display_name ?? '?')[0]}</div>}
            <strong>{r.profile?.game_name ?? r.profile?.display_name}</strong>
            <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: '#e08e0b', color: '#fff' }}>{r.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
            <span style={{ flex: 1 }} />
            <button style={{ padding: '2px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#c00', cursor: 'pointer' }}
              onClick={() => removeFromSession(r.id)}>移出本場</button>
          </div>
        ))}
        </>)
      })()}
    </div>
  )
}
