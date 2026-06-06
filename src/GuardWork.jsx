import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ProgressBar } from './ManuscriptManager'
import { presenceLabel } from './pomodoro'
import SessionStatus from './SessionStatus'
import GuardMemosTab from './GuardMemosTab'
import SessionMemoPanel from './SessionMemoPanel'
import ProfileCard from './ProfileCard'

const PRESENCE_STYLE = {
  '服刑中': { bg: '#d9534f', color: '#fff' },
  '放風中': { bg: '#2a8', color: '#fff' },
  '等待中': { bg: '#eee', color: '#888' },
  '服刑完畢': { bg: '#666', color: '#fff' },
}

function Avatar({ profile, size = 40 }) {
  const name = profile?.game_name ?? profile?.display_name ?? ''
  const initial = name ? name[0] : (profile?.inmate_no != null ? String(profile.inmate_no).slice(-2) : '?')
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: `0 0 ${size}px` }} />
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#3a4049', color: '#e4e5e7', flex: `0 0 ${size}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
      {initial}
    </div>
  )
}

// 獄卒作業頁:狀態階段 → 監管犯人名單(+目標代勾) → 本場獄卒一覽 → 本場犯人一覽
export default function GuardWork({ userId }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [myInmate, setMyInmate] = useState(null)   // 我在本場的 session_inmates 記錄
  const [allGuards, setAllGuards] = useState([])    // 本場 role_in_session='guard'
  const [allInmates, setAllInmates] = useState([])  // 本場 role_in_session='inmate'
  const [myInmates, setMyInmates] = useState([])    // 指派給我的犯人(含本場目標+進度)
  const [stepsByMs, setStepsByMs] = useState({})    // manuscript_id -> [steps]
  const [expanded, setExpanded] = useState([])      // 展開中的目標(session_goals.id)
  const [msg, setMsg] = useState('')
  const [gtab, setGtab] = useState('work')          // 獄卒端子分頁:work=服刑作業 / memos=MEMO確認項

  async function load() {
    setLoading(true)
    // 1) 找我所在的 open 場次 + 我本場記錄
    const { data: si } = await supabase.from('session_inmates')
      .select('id, session_id, role_in_session, state').eq('member_id', userId)
    let mine = null, sess = null
    if (si && si.length) {
      const { data: open } = await supabase.from('sessions')
        .select('id, title, status, timer_started_at, timer_ended_at, total_rounds')
        .in('id', si.map(r => r.session_id)).eq('status', 'open')
      if (open && open.length) { sess = open[0]; mine = si.find(r => r.session_id === sess.id) }
    }
    setSession(sess); setMyInmate(mine)
    if (!mine) {
      setAllGuards([]); setAllInmates([]); setMyInmates([]); setStepsByMs({}); setLoading(false); return
    }

    // 2) 本場名單(分開查再合併),依 role_in_session 切分
    const { data: roster } = await supabase.from('session_inmates')
      .select('id, member_id, role_in_session, state').eq('session_id', sess.id)
    const memberIds = (roster ?? []).map(r => r.member_id)
    const { data: profs } = await supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role').in('id', memberIds)
    const profById = {}; for (const p of profs ?? []) profById[p.id] = p
    const merged = (roster ?? []).map(r => ({ ...r, profile: profById[r.member_id] }))
    const inmateRows = merged.filter(r => r.role_in_session !== 'guard')
    setAllGuards(merged.filter(r => r.role_in_session === 'guard'))
    setAllInmates(inmateRows)

    // 3) 指派給我的犯人:inmate_guards(guard_id=我)∩ 本場犯人
    const inmateRowIds = inmateRows.map(r => r.id)
    let assignedRows = []
    if (inmateRowIds.length) {
      const { data: igs } = await supabase.from('inmate_guards')
        .select('session_inmate_id').eq('guard_id', userId).in('session_inmate_id', inmateRowIds)
      const assignedIds = new Set((igs ?? []).map(g => g.session_inmate_id))
      assignedRows = inmateRows.filter(r => assignedIds.has(r.id))
    }

    // 4) 我監管犯人的本場目標 + 稿件標題 + 子項目(算進度,供代勾)
    const assignedIds = assignedRows.map(r => r.id)
    let goalsByInmate = {}, grouped = {}
    if (assignedIds.length) {
      const { data: goals } = await supabase.from('session_goals')
        .select('id, session_inmate_id, manuscript_id').in('session_inmate_id', assignedIds)
      const msIds = [...new Set((goals ?? []).map(g => g.manuscript_id))]
      const msById = {}
      if (msIds.length) {
        const { data: ms } = await supabase.from('manuscripts')
          .select('id, title, priority').in('id', msIds)
        for (const m of ms ?? []) msById[m.id] = m
        const { data: steps } = await supabase.from('manuscript_steps')
          .select('id, manuscript_id, title, done, sort_order')
          .in('manuscript_id', msIds).order('sort_order').order('created_at')
        for (const s of steps ?? []) (grouped[s.manuscript_id] ??= []).push(s)
      }
      for (const g of goals ?? [])
        (goalsByInmate[g.session_inmate_id] ??= []).push({ ...g, manuscript: msById[g.manuscript_id] })
    }
    setMyInmates(assignedRows.map(r => ({ ...r, goals: goalsByInmate[r.id] ?? [] })))
    setStepsByMs(grouped)
    setLoading(false)
  }

  // 每 10 秒輪詢(接收典獄長報到/指派/開始)
  useEffect(() => {
    if (!userId) return
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [userId])

  // 代勾:獄卒勾選犯人目標子項目(樂觀更新,失敗回滾)
  async function toggleStep(step) {
    const next = !step.done
    const setDone = (val) => setStepsByMs(prev => {
      const arr = prev[step.manuscript_id] ?? []
      return { ...prev, [step.manuscript_id]: arr.map(s => s.id === step.id ? { ...s, done: val } : s) }
    })
    setDone(next)
    const { error } = await supabase.from('manuscript_steps').update({ done: next }).eq('id', step.id)
    if (error) { setDone(step.done); setMsg('子項目更新失敗,已還原:' + error.message) }
  }

  function toggleExpand(goalId) {
    setExpanded(prev => prev.includes(goalId) ? prev.filter(x => x !== goalId) : [...prev, goalId])
  }

  const presence = (r) => {
    if (r.role_in_session === 'guard') return null
    return presenceLabel(session?.timer_started_at, session?.total_rounds ?? 8, session?.timer_ended_at)
  }

  return (
    <div>
      {/* 0) 個人資料卡(當前獄卒自己) */}
      <ProfileCard userId={userId} />

      {/* 獄卒端子分頁:服刑作業 / MEMO·確認項 */}
      <div className="subtabs">
        <button className={gtab === 'work' ? 'on' : ''} onClick={() => setGtab('work')}>服刑作業</button>
        <button className={gtab === 'memos' ? 'on' : ''} onClick={() => setGtab('memos')}>MEMO / 確認項</button>
      </div>

      {gtab === 'memos' ? (
        <GuardMemosTab userId={userId} />
      ) : (
      <>
      {/* 1) 服刑計時 / 狀態階段 */}
      <SessionStatus userId={userId} />

      {loading ? <p className="empty">讀取獄卒作業中…</p> : !myInmate ? (
        <div className="panel" style={{ textAlign: 'center', color: 'var(--dim)' }}>
          你目前不在任何服刑場次中,請等典獄長報到為本場獄卒
        </div>
      ) : (
        <>
          {/* 場次資訊已由上方狀態卡涵蓋,移除重複的場次編號橫幅 */}
          {msg && <div className="banner err">{msg}</div>}

          {/* 本場 MEMO · 確認項(取代犯人本場目標位置)*/}
          <SessionMemoPanel userId={userId} session={session} />

          {/* 2) 監管犯人名單 + 3) 他們的目標清單(可代勾) */}
          <h3>監管犯人</h3>
          {myInmates.length === 0 ? (
            <p className="empty">目前沒有指派給你的犯人(等典獄長指派專屬獄卒)</p>
          ) : myInmates.map(c => {
            const status = presence(c)
            const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['等待中']
            return (
              <div key={c.id} className="panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar profile={c.profile} />
                  <div>
                    <strong>No.{c.profile?.inmate_no != null ? String(c.profile.inmate_no).padStart(4, '0') : '----'}</strong>
                    <span style={{ marginLeft: 6 }}>{c.profile?.game_name ?? c.profile?.display_name ?? '(未知)'}</span>
                  </div>
                  <span className="spacer" />
                  {status && <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>}
                </div>
                <div style={{ marginTop: 10 }}>
                  {c.goals.length === 0 ? (
                    <p className="empty">本場還沒挑目標</p>
                  ) : c.goals.map(g => {
                    const steps = stepsByMs[g.manuscript_id] ?? []
                    const done = steps.filter(s => s.done).length
                    const isOpen = expanded.includes(g.id)
                    return (
                      <div key={g.id} style={{ margin: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ flex: '0 0 150px', fontSize: 14 }}>{g.manuscript?.title ?? '(保密作業)'}</span>
                          <div style={{ flex: 1, minWidth: 140 }}><ProgressBar done={done} total={steps.length} /></div>
                          <button className="btn-sm" onClick={() => toggleExpand(g.id)}>{isOpen ? '收合' : '展開'}</button>
                        </div>
                        {isOpen && (
                          <div className="substeps">
                            {steps.length === 0 ? (
                              <p className="empty">這本稿還沒有子項目</p>
                            ) : steps.map(s => (
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
              </div>
            )
          })}

          {/* 4) 本場獄卒一覽 */}
          <h3>本場獄卒</h3>
          {allGuards.length === 0 ? (
            <p className="empty">本場目前沒有獄卒在場</p>
          ) : allGuards.map(gd => (
            <div key={gd.id} className="panel accent-guard" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar profile={gd.profile} />
              <strong>{gd.profile?.game_name ?? gd.profile?.display_name ?? '(未知)'}</strong>
              <span className="role-tag guard">{gd.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
              {gd.member_id === userId && <span style={{ color: 'var(--hazard)', fontSize: 12 }}>(你)</span>}
            </div>
          ))}

          {/* 5) 本場犯人一覽 */}
          <h3>本場犯人</h3>
          {allInmates.length === 0 ? (
            <p className="empty">本場目前沒有犯人</p>
          ) : allInmates.map(c => {
            const status = presence(c)
            const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['等待中']
            return (
              <div key={c.id} className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar profile={c.profile} />
                <div>
                  <strong>No.{c.profile?.inmate_no != null ? String(c.profile.inmate_no).padStart(4, '0') : '----'}</strong>
                  <span style={{ marginLeft: 6 }}>{c.profile?.game_name ?? c.profile?.display_name ?? '(未知)'}</span>
                </div>
                <span className="spacer" />
                {status && <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>}
              </div>
            )
          })}
        </>
      )}
      </>
      )}
    </div>
  )
}
