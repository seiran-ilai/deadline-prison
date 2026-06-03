import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ProgressBar } from './ManuscriptManager'
import { presenceLabel } from './pomodoro'

const PRESENCE_STYLE = {
  '服刑中': { bg: '#d9534f', color: '#fff' },
  '放風中': { bg: '#2a8', color: '#fff' },
  '等待中': { bg: '#eee', color: '#888' },
  '服刑完畢': { bg: '#666', color: '#fff' },
}

const PRIORITY = {
  1: { label: '高', bg: '#d9534f' },
  2: { label: '中', bg: '#e08e0b' },
  3: { label: '低', bg: '#888' },
}

function Avatar({ profile }) {
  const name = profile?.game_name ?? profile?.display_name ?? ''
  const initial = name ? name[0] : (profile?.inmate_no != null ? String(profile.inmate_no).slice(-2) : '?')
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flex: '0 0 40px' }} />
  }
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#bbb', color: '#fff', flex: '0 0 40px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
      {initial}
    </div>
  )
}

export default function SessionGoals({ userId }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)   // 我目前所在的 open 場次
  const [myInmate, setMyInmate] = useState(null)  // 我在本場的 session_inmates 記錄
  const [goals, setGoals] = useState([])          // session_goals 列(含解析後的稿件資料)
  const [actives, setActives] = useState([])      // 我所有 active 稿件
  const [stepsByMs, setStepsByMs] = useState({})  // manuscript_id -> [steps]
  const [pick, setPick] = useState('')            // 挑選下拉選中的 manuscript_id
  const [expanded, setExpanded] = useState([])    // 展開中的目標(manuscript_id)
  const [cellmates, setCellmates] = useState([])  // 本場同囚(其他犯人)
  const [guards, setGuards] = useState([])        // 本場獄卒(role=guard/warden)
  const [myGuards, setMyGuards] = useState([])    // 我的專屬獄卒(inmate_guards)
  const [sessionTimer, setSessionTimer] = useState(null)  // 本場番茄鐘 {timer_started_at, total_rounds}
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    // 1) 找我有沒有報到進某個 open 場次(分開查,避開巢狀關聯 RLS 坑)
    const { data: si } = await supabase.from('session_inmates')
      .select('id, session_id, state').eq('member_id', userId)
    let mine = null, sess = null
    if (si && si.length) {
      const { data: openSess } = await supabase.from('sessions')
        .select('id, title, status, timer_started_at, total_rounds')
        .in('id', si.map(r => r.session_id)).eq('status', 'open')
      if (openSess && openSess.length) {
        sess = openSess[0]
        mine = si.find(r => r.session_id === sess.id)
      }
    }
    setSession(sess); setMyInmate(mine)
    setSessionTimer(sess ? { timer_started_at: sess.timer_started_at, total_rounds: sess.total_rounds } : null)
    if (!mine) { setGoals([]); setActives([]); setStepsByMs({}); setLoading(false); return }

    // 2) 我的稿件(全部,供解析標題;active 供挑選)
    const { data: ms } = await supabase.from('manuscripts')
      .select('id, title, priority, status').eq('member_id', userId).order('priority').order('created_at')
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
    // 0) 刷新本場番茄鐘狀態(讓 presence 在典獄長開始/重置後 10 秒內反映)
    const { data: sess } = await supabase.from('sessions')
      .select('timer_started_at, total_rounds').eq('id', sessionId).single()
    if (sess) setSessionTimer({ timer_started_at: sess.timer_started_at, total_rounds: sess.total_rounds })
    // 1) 同場其他犯人(排除自己)
    const { data: si } = await supabase.from('session_inmates')
      .select('id, member_id, state').eq('session_id', sessionId).neq('member_id', myMemberId)
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
    // 5) 合併:同囚 → 本場目標稿(讀得到=public 顯示稿名,讀不到=保密作業)
    const goalsByInmate = {}
    for (const g of goals ?? []) (goalsByInmate[g.session_inmate_id] ??= []).push(g)
    const merged = si.map(r => ({
      siId: r.id,
      state: r.state,
      profile: profById[r.member_id],
      works: (goalsByInmate[r.id] ?? []).map(g => {
        const m = msById[g.manuscript_id]
        return { goalId: g.id, title: m?.title, secret: !m }
      }),
    }))
    const isStaffRole = role => role === 'guard' || role === 'warden'
    setGuards(merged.filter(m => isStaffRole(m.profile?.role)))
    setCellmates(merged.filter(m => !isStaffRole(m.profile?.role)))
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

  async function addGoal() {
    if (!pick) return
    const { error } = await supabase.from('session_goals')
      .insert({ session_inmate_id: myInmate.id, manuscript_id: pick })
    if (error) { setMsg('加入失敗:' + error.message); return }
    setPick(''); setMsg('已加入本場'); load()
  }

  async function removeGoal(goalId) {
    const { error } = await supabase.from('session_goals').delete().eq('id', goalId)
    if (error) { setMsg('取消失敗:' + error.message); return }
    setMsg('已移出本場'); load()
  }

  async function toggleStep(step) {
    const next = !step.done
    // 1) 樂觀更新:先改本地 state,畫面與進度條立即反映
    setStepsByMs(prev => {
      const arr = prev[step.manuscript_id] ?? []
      return { ...prev, [step.manuscript_id]: arr.map(s => s.id === step.id ? { ...s, done: next } : s) }
    })
    // 2) 背景寫 DB,不重載整頁
    const { error } = await supabase.from('manuscript_steps').update({ done: next }).eq('id', step.id)
    if (error) console.error('[SessionGoals] 子項目寫入失敗', step.id, error)
  }

  function toggleExpand(manuscriptId) {
    setExpanded(prev => prev.includes(manuscriptId)
      ? prev.filter(x => x !== manuscriptId)
      : [...prev, manuscriptId])
  }

  const card = { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 12, background: '#fff', color: '#222' }
  const input = { padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222', colorScheme: 'light' }
  const btn = { padding: '6px 12px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }

  if (loading) return <p style={{ color: '#888' }}>讀取本場狀態中…</p>

  if (!myInmate) {
    return (
      <div style={{ ...card, textAlign: 'center', color: '#666' }}>
        你目前不在任何服刑場次中,請等典獄長報到
      </div>
    )
  }

  // 可挑選 = active 稿件中,尚未挑進本場的
  const goalIds = goals.map(g => g.manuscript_id)
  const available = actives.filter(m => !goalIds.includes(m.id))

  return (
    <div style={{ color: '#222' }}>
      <div style={{ ...card, background: '#eef4ff' }}>
        <strong>本場服刑:{session.title}</strong>
        <span style={{ marginLeft: 8, color: '#666', fontSize: 13 }}>狀態:{myInmate.state}</span>
      </div>

      {msg && <p style={{ color: '#2a7' }}>{msg}</p>}

      <div style={{ ...card, background: '#fff7ec' }}>
        <strong>專屬獄卒</strong>
        {myGuards.length === 0 ? (
          <p style={{ color: '#888', margin: '8px 0 0' }}>本場由全體獄卒看管</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
            {myGuards.map(g => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar profile={g.profile} />
                <div>
                  <strong>{g.profile?.game_name ?? g.profile?.display_name ?? '(未知)'}</strong>
                  <span style={{ marginLeft: 6, fontSize: 12, padding: '1px 8px', borderRadius: 10, background: '#e08e0b', color: '#fff' }}>
                    {g.profile?.role === 'warden' ? '典獄長' : '獄卒'}
                  </span>
                  <div style={{ color: '#c60', fontSize: 12 }}>👁 正在看著你服刑</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3>本場目標</h3>
      {goals.length === 0 ? (
        <p style={{ color: '#888' }}>還沒挑本場目標,從下面加入要推進的稿件</p>
      ) : goals.map(g => {
        const steps = stepsByMs[g.manuscript_id] ?? []
        const done = steps.filter(s => s.done).length
        const p = PRIORITY[g.manuscript?.priority] ?? PRIORITY[2]
        const isOpen = expanded.includes(g.manuscript_id)
        return (
          <div key={g.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: p.bg, color: '#fff', fontSize: 12, padding: '1px 8px', borderRadius: 10 }}>{p.label}</span>
              <strong>{g.manuscript?.title ?? '(稿件已不存在)'}</strong>
              <span style={{ flex: 1 }} />
              <button style={btn} onClick={() => toggleExpand(g.manuscript_id)}>{isOpen ? '收合' : '展開子項目'}</button>
              <button style={btn} onClick={() => removeGoal(g.id)}>取消</button>
            </div>
            <div style={{ marginTop: 10 }}><ProgressBar done={done} total={steps.length} /></div>

            {isOpen && (
              <div style={{ marginTop: 12, borderTop: '1px dashed #ddd', paddingTop: 12 }}>
                {steps.length === 0 ? (
                  <p style={{ color: '#999', margin: 0 }}>這本稿還沒有子項目(到「我的稿件」新增)</p>
                ) : steps.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input type="checkbox" checked={s.done} onChange={() => toggleStep(s)} />
                    <span style={{ textDecoration: s.done ? 'line-through' : 'none', color: s.done ? '#999' : '#222' }}>{s.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <h3 style={{ marginTop: 20 }}>挑選新目標</h3>
      {available.length === 0 ? (
        <p style={{ color: '#888' }}>沒有可挑的 active 稿件(都挑進來了,或先到「我的稿件」新增)</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={input} value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">— 選一本稿件 —</option>
            {available.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <button style={{ ...btn, background: '#eef4ff' }} onClick={addGoal}>加入本場</button>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>本場獄卒</h3>
      {guards.length === 0 ? (
        <p style={{ color: '#888' }}>本場目前沒有獄卒在場</p>
      ) : guards.map(gd => (
        <div key={gd.siId} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, background: '#fff7ec' }}>
          <Avatar profile={gd.profile} />
          <div>
            <strong>{gd.profile?.game_name ?? gd.profile?.display_name ?? '(未知)'}</strong>
            <span style={{ marginLeft: 6, fontSize: 12, padding: '1px 8px', borderRadius: 10, background: '#e08e0b', color: '#fff' }}>
              {gd.profile?.role === 'warden' ? '典獄長' : '獄卒'}
            </span>
          </div>
          <span style={{ flex: 1 }} />
          <span style={{ color: '#c60', fontSize: 13 }}>👁 陪伴你的獄卒</span>
        </div>
      ))}

      <h3 style={{ marginTop: 24 }}>本場同囚</h3>
      {cellmates.length === 0 ? (
        <p style={{ color: '#888' }}>本場目前只有你一個人,或還沒有其他人報到</p>
      ) : cellmates.map(c => {
        const status = presenceLabel(sessionTimer?.timer_started_at, sessionTimer?.total_rounds ?? 8)
        const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['等待中']
        return (
        <div key={c.siId} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar profile={c.profile} />
            <div>
              <strong>No.{c.profile?.inmate_no != null ? String(c.profile.inmate_no).padStart(4, '0') : '----'}</strong>
              <span style={{ marginLeft: 6 }}>{c.profile?.game_name ?? c.profile?.display_name ?? '(未知)'}</span>
            </div>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: ps.bg, color: ps.color }}>{status}</span>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {c.works.length === 0 ? (
              <span style={{ color: '#aaa', fontSize: 13 }}>本場還沒挑稿</span>
            ) : c.works.map(w => (
              <span key={w.goalId} style={{ fontSize: 13, padding: '2px 10px', borderRadius: 12, background: w.secret ? '#eee' : '#eef4ff', color: w.secret ? '#888' : '#33558a' }}>
                {w.secret ? '🔒 保密作業' : w.title}
              </span>
            ))}
          </div>
        </div>
        )
      })}
    </div>
  )
}
