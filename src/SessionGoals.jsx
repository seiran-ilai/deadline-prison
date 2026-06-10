import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ProgressBar } from './ManuscriptManager'
import MessageBanner from './MessageBanner'
import SessionStatus from './SessionStatus'
import { computeProgress, goalStatusLabel } from './progress'
import ProfileCard from './ProfileCard'
import SessionVisits from './SessionVisits'
import { normalizeStatus } from './warden/constants'

// 同囚列狀態 chip 樣式:只承載「目標完成度」三態,不再呈現番茄鐘(專注/放風)。
const PRESENCE_STYLE = {
  '服刑完畢': { bg: '#666', color: '#fff' },                       // 完成:深灰
  '服刑中': { bg: '#d9534f', color: '#fff' },                      // 進行中:警示紅
  '尚未挑稿': { bg: 'rgba(255,255,255,.08)', color: '#9298a2' },   // 沒挑目標:次要灰
}

const PRIORITY = {
  1: { label: '高', bg: '#d9534f' },
  2: { label: '中', bg: '#e08e0b' },
  3: { label: '低', bg: '#888' },
}

export default function SessionGoals({ userId, onGoToManuscripts }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)   // 我目前所在的 open 場次
  const [myInmate, setMyInmate] = useState(null)  // 我在本場的 session_inmates 記錄
  const [goals, setGoals] = useState([])          // session_goals 列(含解析後的稿件資料)
  const [actives, setActives] = useState([])      // 我所有 active 稿件
  const [stepsByMs, setStepsByMs] = useState({})  // manuscript_id -> [steps]
  const [pick, setPick] = useState('')            // 挑選下拉選中的 manuscript_id(沿用;modal 直接帶 id)
  const [goalModalOpen, setGoalModalOpen] = useState(false) // 「新增本場目標」modal 開關
  const [expanded, setExpanded] = useState([])    // 展開中的目標(manuscript_id)
  const [showAllGoals, setShowAllGoals] = useState(false)     // 本場目標:展開全部(取消固定高度)
  const [showAllInmates, setShowAllInmates] = useState(false) // 本場囚犯:展開全部(取消固定高度)
  const [cellmates, setCellmates] = useState([])  // 本場同囚(其他犯人)
  const [guards, setGuards] = useState([])        // 本場獄卒(role=guard/warden)
  const [myGuards, setMyGuards] = useState([])    // 我的專屬獄卒(inmate_guards)
  const [myProfile, setMyProfile] = useState(null)        // 我自己的 profile(本場囚犯列「你」那筆顯示用)
  const [msg, setMsg] = useState('')

  async function load(silent) {
    if (!silent) setLoading(true)   // silent=true:modal 連續挑稿時的背景刷新,不閃整頁 loading(資料流不變)
    // 1) 找我有沒有報到進某個 open 場次(分開查,避開巢狀關聯 RLS 坑)
    const { data: si } = await supabase.from('session_inmates')
      .select('id, session_id, state').eq('member_id', userId)
    let mine = null, sess = null
    if (si && si.length) {
      // 全撈 + normalizeStatus 過濾(過渡期 DB 仍可能有舊值,不用 .eq('status','open'))
      const { data: rows } = await supabase.from('sessions')
        .select('id, title, status, timer_started_at, timer_ended_at, total_rounds')
        .in('id', si.map(r => r.session_id))
      const live = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended')
      sess = live[0] ?? null
      if (sess) mine = si.find(r => r.session_id === sess.id)
    }
    setSession(sess); setMyInmate(mine)
    if (!mine) { setGoals([]); setActives([]); setStepsByMs({}); setLoading(false); return }

    // 我自己的 profile(顯示在「本場囚犯」列的「你」那筆;與身分卡同一來源)
    const { data: meProf } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url').eq('id', userId).maybeSingle()
    setMyProfile(meProf ?? null)

    // 2) 我的稿件(全部,供解析標題;active 供挑選)
    const { data: ms } = await supabase.from('manuscripts')
      .select('id, title, priority, status, is_done').eq('member_id', userId).order('priority').order('created_at')
    const msById = {}; for (const m of ms ?? []) msById[m.id] = m
    setActives((ms ?? []).filter(m => m.status === 'active'))

    // 3) 本場目標
    const { data: g } = await supabase.from('session_goals')
      .select('id, manuscript_id').eq('session_inmate_id', mine.id)
    const goalRows = (g ?? []).map(x => ({ ...x, manuscript: msById[x.manuscript_id] }))
    setGoals(goalRows)

    // 4) 目標稿件的子項目(算進度)
    const goalMsIds = goalRows.map(x => x.manuscript_id)
    if (goalMsIds.length) {
      const { data: steps } = await supabase.from('manuscript_steps')
        .select('id, manuscript_id, title, done, sort_order')
        .in('manuscript_id', goalMsIds).order('sort_order').order('created_at')
      const grouped = {}
      for (const s of steps ?? []) (grouped[s.manuscript_id] ??= []).push(s)
      setStepsByMs(grouped)
    } else {
      setStepsByMs({})
    }
    setLoading(false)
  }
  useEffect(() => { if (userId) load() }, [userId])

  // 本場同囚:分開查再合併(避開 RLS 巢狀查詢坑),不走會閃 loading 的 load()
  async function loadCellmates(sessionId, myMemberId) {
    // 1) 同場其他人(排除自己)
    const { data: si } = await supabase.from('session_inmates')
      .select('id, member_id, state, role_in_session').eq('session_id', sessionId).neq('member_id', myMemberId)
    if (!si || si.length === 0) { setCellmates([]); setGuards([]); return }
    const memberIds = si.map(r => r.member_id)
    const siIds = si.map(r => r.id)
    // 2) 他們的 profiles(含 role,用來分出獄卒)
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', memberIds)
    const profById = {}; for (const p of profs ?? []) profById[p.id] = p
    // 3) 他們的本場目標
    const { data: goals } = await supabase.from('session_goals')
      .select('id, session_inmate_id, manuscript_id').in('session_inmate_id', siIds)
    // 4) 目標稿件(RLS 只會回 public 的,staff/private 讀不到)
    const msIds = [...new Set((goals ?? []).map(g => g.manuscript_id))]
    const msById = {}
    if (msIds.length) {
      const { data: ms } = await supabase.from('manuscripts')
        .select('id, title, visibility').in('id', msIds)
      for (const m of ms ?? []) msById[m.id] = m
    }
    // 4.5) 同囚每個目標的完成度聚合(done/total/is_done)。
    //   steps 對同囚不可讀,改用 SECURITY DEFINER RPC 只取「數字」(不外洩子項目標題),
    //   再用統一的 computeProgress 判定每個目標是否完成 → 狀態 chip 脫離番茄鐘。
    const { data: prog } = await supabase.rpc('session_goal_progress', { p_session_inmate_ids: siIds })
    const progByInmate = {}
    for (const row of prog ?? []) (progByInmate[row.session_inmate_id] ??= []).push(row)

    // 5) 合併:同囚 → 本場目標稿(讀得到=public 顯示稿名,讀不到=保密作業)+ 完成度狀態
    const goalsByInmate = {}
    for (const g of goals ?? []) (goalsByInmate[g.session_inmate_id] ??= []).push(g)
    const merged = si.map(r => {
      const works = (goalsByInmate[r.id] ?? []).map(g => {
        const m = msById[g.manuscript_id]
        return { goalId: g.id, title: m?.title, secret: !m }
      })
      // 該同囚自己的目標完成度:total 以「目標數」為準,done 由 RPC 聚合 + computeProgress 判定
      const totalGoals = works.length
      const doneGoals = (progByInmate[r.id] ?? [])
        .filter(row => computeProgress({ done: row.done, total: row.total, isDone: row.is_done }).complete).length
      return {
        siId: r.id,
        state: r.state,
        roleInSession: r.role_in_session,
        profile: profById[r.member_id],
        works,
        status: goalStatusLabel(doneGoals, totalGoals),
      }
    })
    // 依「本場身分」切分:本場獄卒一覽 vs 本場犯人一覽(兩層身分,非全域 role)
    setGuards(merged.filter(m => m.roleInSession === 'guard'))
    setCellmates(merged.filter(m => m.roleInSession !== 'guard'))
  }

  // 我的專屬獄卒(分開查 inmate_guards → profiles 合併)
  async function loadMyGuards(sessionInmateId) {
    const { data: igs } = await supabase.from('inmate_guards')
      .select('id, guard_id').eq('session_inmate_id', sessionInmateId)
    if (!igs || !igs.length) { setMyGuards([]); return }
    const { data: profs } = await supabase.from('profiles')
      .select('id, game_name, display_name, avatar_url, role').in('id', igs.map(g => g.guard_id))
    const byId = {}; for (const p of profs ?? []) byId[p.id] = p
    setMyGuards(igs.map(g => ({ id: g.id, profile: byId[g.guard_id] })))
  }

  // 每 10 秒輪詢本場同囚 + 專屬獄卒;場次變動時重設,卸載時清掉 interval
  useEffect(() => {
    if (!session?.id || !userId) return
    const refresh = () => {
      loadCellmates(session.id, userId)
      if (myInmate?.id) loadMyGuards(myInmate.id)
    }
    refresh()
    const timer = setInterval(refresh, 10000)
    return () => clearInterval(timer)
  }, [session?.id, userId, myInmate?.id])

  async function addGoal(manuscriptId) {
    const mid = manuscriptId ?? pick   // modal 直接帶稿件 id;沿用原下拉時讀 pick
    if (!mid) return
    const { error } = await supabase.from('session_goals')
      .insert({ session_inmate_id: myInmate.id, manuscript_id: mid })
    if (error) { setMsg('加入失敗：' + error.message); return }
    setPick(''); setMsg('已加入本場'); load(true)  // 背景刷新,modal 保持開著可連續挑
  }

  async function removeGoal(goalId) {
    // 樂觀更新:立即從本地 state 移除該筆,畫面即時更新(不重整、不重抓整場)。
    // 衍生顯示(進度條/完成度/計數/可挑清單)都由 goals 重算,故無需重抓。
    const snapshot = goals
    setGoals(gs => gs.filter(g => g.id !== goalId))
    const { error } = await supabase.from('session_goals').delete().eq('id', goalId)
    if (error) {
      setGoals(snapshot)   // 失敗回滾:把該筆加回,避免畫面與後端不一致
      setMsg('取消失敗，已還原：' + error.message)
      return
    }
    setMsg('已移出本場')
  }

  async function toggleStep(step) {
    const next = !step.done
    const setDone = (val) => setStepsByMs(prev => {
      const arr = prev[step.manuscript_id] ?? []
      return { ...prev, [step.manuscript_id]: arr.map(s => s.id === step.id ? { ...s, done: val } : s) }
    })
    // 1) 樂觀更新:先改本地 state,畫面與進度條立即反映
    setDone(next)
    // 2) 背景寫 DB;失敗則回滾畫面並提示(避免畫面與 DB 不一致)
    const { error } = await supabase.from('manuscript_steps').update({ done: next }).eq('id', step.id)
    if (error) { setDone(step.done); setMsg('子項目更新失敗，已還原：' + error.message) }
  }

  // 無子項目稿件:大項本身就是完成勾選(寫 manuscripts.is_done;樂觀更新,與子項目同一條完成度邏輯)
  async function toggleManuscriptDone(goal) {
    const next = !goal.manuscript?.is_done
    const setDone = (val) => setGoals(prev => prev.map(g =>
      g.id === goal.id ? { ...g, manuscript: { ...g.manuscript, is_done: val } } : g))
    setDone(next)
    const { error } = await supabase.from('manuscripts').update({ is_done: next }).eq('id', goal.manuscript_id)
    if (error) { setDone(!next); setMsg('更新失敗，已還原：' + error.message) }
  }

  function toggleExpand(manuscriptId) {
    setExpanded(prev => prev.includes(manuscriptId)
      ? prev.filter(x => x !== manuscriptId)
      : [...prev, manuscriptId])
  }

  // 防呆:userId 尚未就緒(首次登入流程)時不掛載
  if (!userId) return null
  if (loading) return (
    <div>
      <SessionStatus userId={userId} />
      <p className="empty">讀取本場狀態中…</p>
    </div>
  )

  if (!myInmate) {
    // 未報到/未配對的狀態已由上方狀態卡(SessionStatus)涵蓋,不再顯示重複且可能矛盾的訊息框
    return (
      <div>
        <SessionStatus userId={userId} />
      </div>
    )
  }

  // 場次狀態(myInmate 存在代表我在這場)。狀態一律看 normalizeStatus。
  // ended 為防呆分支:外層 SessionView 一般已擋掉已結束場次,保險起見顯示收尾卡。
  const ds = normalizeStatus(session)
  if (ds === 'ended') {
    return (
      <div className="sg-page">
        <div className="card-panel">
          <div className="head"><h2>本場已結束</h2></div>
          <div className="body">
            <p className="empty">本場服刑已結束，可至「服刑紀錄」查看本場成果</p>
          </div>
        </div>
      </div>
    )
  }
  const isIntake = ds === 'intake'   // 等待室:本場目標仍可編輯,僅多一個提示徽章

  // 可挑選 = active 稿件中,尚未挑進本場的
  const goalIds = goals.map(g => g.manuscript_id)
  const available = actives.filter(m => !goalIds.includes(m.id))

  return (
    <div className="sg-page">
      <MessageBanner msg={msg} onClose={() => setMsg('')} />

      {/* === 上排:我 + 專屬獄卒 + 計時器(主角) === */}
      <div className="ses-top prisoner">
        {/* 我(直式身分卡,沿用 ProfileCard 的個人資料來源 + 編輯) */}
        <ProfileCard userId={userId} variant="id" label="我 · 服刑中" editable={false} />

        {/* 專屬獄卒(直式卡;骨架與 ProfileCard variant="id" 一致:id-av / id-lbl / id-no / id-nm / id-watch,
            缺的欄位以 &nbsp; + 既有 min-height 留白佔位;底部以 id-spacer(margin-top:auto)推齊讓並排卡片對齊) */}
        {myGuards.length > 0 ? (
          <div className="idcard-stack">
            {myGuards.map(g => (
              <div key={g.id} className="idcard">
                <div className="id-av">
                  {g.profile?.avatar_url
                    ? <img src={g.profile.avatar_url} alt="" />
                    : (g.profile?.game_name ?? g.profile?.display_name ?? '?')[0]}
                </div>
                <div className="id-lbl">專屬獄卒</div>
                <div className="id-no">{' '}</div>
                <div className="id-nm">
                  {g.profile?.game_name ?? g.profile?.display_name ?? '（未知）'}
                  <span className="role-tag guard">{g.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                </div>
                <div className="id-watch">👁 正在看著你服刑</div>
                <div className="id-spacer" aria-hidden="true">&nbsp;</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="idcard">
            <div className="id-av">？</div>
            <div className="id-lbl">專屬獄卒</div>
            <div className="id-no">{' '}</div>
            <div className="id-nm muted">尚未配對</div>
            <div className="id-watch">&nbsp;</div>
            <div className="id-spacer" aria-hidden="true">&nbsp;</div>
          </div>
        )}

        {/* 計時器(主角) */}
        <SessionStatus userId={userId} />
      </div>

      {/* === 中段兩欄:本場目標 + 本場囚犯 === */}
      <div className="ses-mid">

      {/* 本場目標 */}
      <div className="card-panel">
        <div className="head">
          <h2>本場目標</h2>
          {goals.length > 0 && <span className="count">{goals.length} 項</span>}
          {isIntake && <span className="hint-badge">等待開始服刑，可先挑選本場目標</span>}
          {goals.length > 5 && (
            <>
              <span className="spacer" />
              <button className="btn-sm cap-toggle" onClick={() => setShowAllGoals(v => !v)}>
                {showAllGoals ? '收合 ⌃' : '展開全部 ⌄'}
              </button>
            </>
          )}
        </div>
        <div className="body">
          {goals.length === 0 ? (
            <p className="empty">還沒挑本場目標，點下方按鈕加入要推進的稿件</p>
          ) : (
          <div className={`cap-list${showAllGoals ? '' : ' capped'}`}>
          {goals.map(g => {
            const steps = stepsByMs[g.manuscript_id] ?? []
            const prog = computeProgress({ steps, isDone: g.manuscript?.is_done })
            const p = PRIORITY[g.manuscript?.priority] ?? PRIORITY[2]
            const isOpen = expanded.includes(g.manuscript_id)
            return (
              <div key={g.id} className="panel">
                <div className="panel-head">
                  {/* 無子項目:大項本身就是可勾的 checkbox(勾=100%、取消=0%,寫 is_done) */}
                  {!prog.hasSteps && g.manuscript && (
                    <input type="checkbox" className="ms-done-check" checked={!!g.manuscript.is_done}
                      onChange={() => toggleManuscriptDone(g)} title="標記整本完成" />
                  )}
                  <span className="chip" style={{ background: p.bg }}>{p.label}</span>
                  <strong className={!prog.hasSteps && g.manuscript?.is_done ? 'done-text' : ''}>{g.manuscript?.title ?? '（稿件已不存在）'}</strong>
                  <span className="spacer" />
                  {/* 有子項目才需要展開;無子項目大項已可直接勾,不顯示展開 */}
                  {prog.hasSteps && (
                    <button className="btn-sm" onClick={() => toggleExpand(g.manuscript_id)}>{isOpen ? '收合' : '展開子項目'}</button>
                  )}
                  <button className="btn-sm" onClick={() => removeGoal(g.id)}>取消</button>
                </div>
                <div style={{ marginTop: 10 }}><ProgressBar progress={prog} /></div>

                {prog.hasSteps && isOpen && (
                  <div className="substeps" style={{ marginTop: 12 }}>
                    {steps.map(s => (
                      <div key={s.id} className="step">
                        <input type="checkbox" checked={s.done} onChange={() => toggleStep(s)} />
                        <span className={s.done ? 'done-text' : ''}>{s.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          </div>
          )}
          <div className="toolbar" style={{ marginTop: goals.length ? 12 : 4 }}>
            <button className="btn-pri" onClick={() => setGoalModalOpen(true)}>＋ 新增本場目標</button>
          </div>
        </div>
      </div>

      {/* 本場囚犯(含我,我那筆高亮標「你」) */}
      <div className="card-panel">
        <div className="head">
          <h2>本場囚犯</h2>
          <span className="count">{cellmates.length + 1} 人</span>
          {cellmates.length + 1 > 5 && (
            <>
              <span className="spacer" />
              <button className="btn-sm cap-toggle" onClick={() => setShowAllInmates(v => !v)}>
                {showAllInmates ? '收合 ⌃' : '展開全部 ⌄'}
              </button>
            </>
          )}
        </div>
        <div className="body">
          <div className={`cap-list${showAllInmates ? '' : ' capped'}`}>
          {/* 我 */}
          <div className="inmate me">
            <div className="in-av">
              {myProfile?.avatar_url
                ? <img src={myProfile.avatar_url} alt="" />
                : (myProfile?.game_name ?? myProfile?.display_name ?? '你')[0]}
            </div>
            <div>
              <div className="in-nm">{myProfile?.game_name ?? myProfile?.display_name ?? '（未命名）'}</div>
              <div className="in-no">No.{myProfile?.inmate_no != null ? String(myProfile.inmate_no).padStart(4, '0') : '----'} · 你</div>
            </div>
            <span className="in-prog">目標 {goals.filter(g => computeProgress({ steps: stepsByMs[g.manuscript_id] ?? [], isDone: g.manuscript?.is_done }).complete).length}/{goals.length}</span>
          </div>
          {/* 其他同囚 */}
          {cellmates.map(c => {
            const status = c.status   // 依「該同囚本場目標完成度」判定,與番茄鐘無關
            const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['尚未挑稿']
            return (
              <div key={c.siId} className="inmate">
                <div className="in-av">
                  {c.profile?.avatar_url
                    ? <img src={c.profile.avatar_url} alt="" />
                    : (c.profile?.game_name ?? c.profile?.display_name ?? '?')[0]}
                </div>
                <div>
                  <div className="in-nm">{c.profile?.game_name ?? c.profile?.display_name ?? '（未知）'}</div>
                  <div className="in-no">No.{c.profile?.inmate_no != null ? String(c.profile.inmate_no).padStart(4, '0') : '----'}</div>
                </div>
                <span className="spacer" />
                <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>
                <div className="in-works">
                  {c.works.length === 0 ? (
                    <span className="empty">本場還沒挑稿</span>
                  ) : c.works.map(w => (
                    <span key={w.goalId} className="chip" style={{ background: w.secret ? 'rgba(255,255,255,.08)' : 'rgba(245,197,24,.15)', color: w.secret ? 'var(--dim)' : 'var(--hazard)' }}>
                      {w.secret ? '🔒 保密作業' : w.title}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
          </div>
        </div>
      </div>

      </div>{/* === /中段兩欄 === */}

      {/* === 本場廣播(探望我的,唯讀) === */}
      <SessionVisits sessionId={session.id} userId={userId} role="inmate" />

      {/* === 底部:本場獄卒(頭貼格狀) === */}
      <div className="card-panel sg-section">
        <div className="head"><h2>本場獄卒</h2>{guards.length > 0 && <span className="count">{guards.length} 位</span>}</div>
        <div className="body">
          {guards.length === 0 ? (
            <p className="empty">本場目前沒有獄卒在場</p>
          ) : (
            <div className="guard-grid">
              {guards.map(gd => (
                <div key={gd.siId} className="guard-cell">
                  <div className="g-av">
                    {gd.profile?.avatar_url
                      ? <img src={gd.profile.avatar_url} alt="" />
                      : (gd.profile?.game_name ?? gd.profile?.display_name ?? '?')[0]}
                  </div>
                  <div className="g-nm">{gd.profile?.game_name ?? gd.profile?.display_name ?? '（未知）'}</div>
                  <span className="role-tag guard">{gd.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 新增本場目標 modal:把原本 inline 挑稿清單搬進 modal,挑稿沿用既有 addGoal,可連續挑多筆。
          available 即時依 goals/actives 重算(挑進來的稿自動從清單移除)。 */}
      {goalModalOpen && (
        <div className="admin-modal-bg" onClick={() => setGoalModalOpen(false)}>
          <div className="admin-modal goal-modal" onClick={e => e.stopPropagation()}>
            <div className="goal-modal-head">
              <h3>新增本場目標</h3>
              <button className="goal-modal-x" onClick={() => setGoalModalOpen(false)}>✕</button>
            </div>
            {available.length === 0 ? (
              <div className="goal-modal-empty">
                <p className="warn">沒有可挑的 active 稿件（都挑進來了，或先到「我的稿件」新增）</p>
                {onGoToManuscripts && (
                  <button className="btn-pri" onClick={() => { setGoalModalOpen(false); onGoToManuscripts() }}>前往我的稿件</button>
                )}
              </div>
            ) : (
              <div className="goal-pick-list">
                {available.map(m => (
                  <button key={m.id} className="goal-pick" onClick={() => addGoal(m.id)}>
                    <span className="goal-pick-title">{m.title}</span>
                    <span className="goal-pick-add">＋ 加入</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
