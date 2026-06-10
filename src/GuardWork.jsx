import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ProgressBar } from './ManuscriptManager'
import { computeProgress, goalStatusLabel } from './progress'
import SessionStatus from './SessionStatus'
import SessionMemoPanel from './SessionMemoPanel'
import SessionVisits from './SessionVisits'
import ProfileCard from './ProfileCard'
import { normalizeStatus } from './warden/constants'

// 犯人列狀態 chip 樣式:只承載「目標完成度」三態,不再呈現番茄鐘(專注/放風)。
const PRESENCE_STYLE = {
  '服刑完畢': { bg: '#666', color: '#fff' },                       // 完成:深灰
  '服刑中': { bg: '#d9534f', color: '#fff' },                      // 進行中:警示紅
  '尚未挑稿': { bg: 'rgba(255,255,255,.08)', color: '#9298a2' },   // 沒挑目標:次要灰
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

  async function load() {
    setLoading(true)
    // 1) 找我所在的 open 場次 + 我本場記錄
    const { data: si } = await supabase.from('session_inmates')
      .select('id, session_id, role_in_session, state').eq('member_id', userId)
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

    // 3) 指派給我的犯人:inmate_guards(guard_id=我)∩ 本場犯人
    const inmateRowIds = inmateRows.map(r => r.id)
    let assignedRows = []
    if (inmateRowIds.length) {
      const { data: igs } = await supabase.from('inmate_guards')
        .select('session_inmate_id').eq('guard_id', userId).in('session_inmate_id', inmateRowIds)
      const assignedIds = new Set((igs ?? []).map(g => g.session_inmate_id))
      assignedRows = inmateRows.filter(r => assignedIds.has(r.id))
    }

    // 4) 本場「全部犯人」的本場目標 + 稿件 + 子項目。
    //   staff 可讀全部,故狀態 chip(服刑完畢/服刑中/尚未挑稿)對「我看守的」與「其他囚犯」一致;
    //   我看守的另外用 stepsByMs 支援代勾。
    let goalsByInmate = {}, grouped = {}
    if (inmateRowIds.length) {
      const { data: goals } = await supabase.from('session_goals')
        .select('id, session_inmate_id, manuscript_id').in('session_inmate_id', inmateRowIds)
      const msIds = [...new Set((goals ?? []).map(g => g.manuscript_id))]
      const msById = {}
      if (msIds.length) {
        const { data: ms } = await supabase.from('manuscripts')
          .select('id, title, priority, is_done').in('id', msIds)
        for (const m of ms ?? []) msById[m.id] = m
        const { data: steps } = await supabase.from('manuscript_steps')
          .select('id, manuscript_id, title, done, sort_order')
          .in('manuscript_id', msIds).order('sort_order').order('created_at')
        for (const s of steps ?? []) (grouped[s.manuscript_id] ??= []).push(s)
      }
      for (const g of goals ?? [])
        (goalsByInmate[g.session_inmate_id] ??= []).push({ ...g, manuscript: msById[g.manuscript_id] })
    }
    const withGoals = (r) => ({ ...r, goals: goalsByInmate[r.id] ?? [] })
    setAllInmates(inmateRows.map(withGoals))
    setMyInmates(assignedRows.map(withGoals))
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
    if (error) { setDone(step.done); setMsg('子項目更新失敗，已還原：' + error.message) }
  }

  function toggleExpand(goalId) {
    setExpanded(prev => prev.includes(goalId) ? prev.filter(x => x !== goalId) : [...prev, goalId])
  }

  // 狀態 chip:只依「該犯人本場目標完成度」(脫離番茄鐘);帶該犯人自己的 goals。
  const presence = (r) => {
    if (r.role_in_session === 'guard') return null
    const goals = r.goals ?? []
    const done = goals.filter(g =>
      computeProgress({ steps: stepsByMs[g.manuscript_id] ?? [], isDone: g.manuscript?.is_done }).complete).length
    return goalStatusLabel(done, goals.length)
  }

  // 防呆:userId 尚未就緒(首次登入流程)時不掛載
  if (!userId) return null

  return (
    <div>
      {loading ? (
        <p className="empty">讀取獄卒作業中…</p>
      ) : (
      <>
      {msg && <div className="banner err">{msg}</div>}

      {/* === 上排:我(獄卒) + 計時器(主角,較寬,無專屬獄卒欄) === */}
      <div className="ses-top guard">
        <ProfileCard userId={userId} variant="id" label="我 · 看守中" editable={false}
          footer={myInmate ? <div className="id-watch">👁 專屬看守 {myInmates.length} 人 · 本場共 {allInmates.length} 人</div> : null} />
        <SessionStatus userId={userId} />
      </div>

      {/* ended 防呆提示(外層一般已擋已結束場次,保險起見;名單維持顯示供獄卒收尾檢視) */}
      {session && normalizeStatus(session) === 'ended' && (
        <div className="banner">本場已結束</div>
      )}

      {!myInmate ? (
        <div className="card-panel"><div className="body">
          <p className="empty" style={{ textAlign: 'center' }}>你目前不在任何服刑場次中，請等典獄長報到為本場獄卒</p>
        </div></div>
      ) : (
        <>
          {/* === 中段兩欄:本場 MEMO + 本場囚犯 === */}
          <div className="ses-mid">
            {/* 本場 MEMO · 確認項(沿用既有元件 / 邏輯,只套版位) */}
            <SessionMemoPanel userId={userId} session={session} />

            {/* 本場囚犯:我看守的置頂高亮 + 其餘分組 */}
            <div className="card-panel">
              <div className="head"><h2>本場囚犯</h2><span className="count">{allInmates.length} 人</span></div>
              <div className="body">
                {/* 我看守的(綠框高亮、指派給我;保留目標代勾) */}
                <div className="subgroup mine first">我看守的犯人 ({myInmates.length})<span className="ln" /></div>
                {myInmates.length === 0 ? (
                  <p className="empty">目前沒有指派給你的犯人（等典獄長指派專屬獄卒）</p>
                ) : myInmates.map(c => {
                  const status = presence(c)
                  const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['等待中']
                  return (
                    <div key={c.id} className="inmate mine" style={{ alignItems: 'flex-start' }}>
                      <div className="in-av">
                        {c.profile?.avatar_url ? <img src={c.profile.avatar_url} alt="" />
                          : (c.profile?.game_name ?? c.profile?.display_name ?? '?')[0]}
                      </div>
                      <div>
                        <div className="in-nm">{c.profile?.game_name ?? c.profile?.display_name ?? '（未知）'}<span className="tag-mine">指派給我</span></div>
                        <div className="in-no">No.{c.profile?.inmate_no != null ? String(c.profile.inmate_no).padStart(4, '0') : '----'}</div>
                      </div>
                      <span className="spacer" />
                      {status && <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>}
                      <div className="in-works">
                        {c.goals.length === 0 ? (
                          <p className="empty">本場還沒挑目標</p>
                        ) : c.goals.map(g => {
                          const steps = stepsByMs[g.manuscript_id] ?? []
                          const prog = computeProgress({ steps, isDone: g.manuscript?.is_done })
                          const isOpen = expanded.includes(g.id)
                          return (
                            <div key={g.id} style={{ width: '100%', margin: '4px 0' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ flex: '0 0 150px', fontSize: 14 }}>{g.manuscript?.title ?? '（保密作業）'}</span>
                                <div style={{ flex: 1, minWidth: 140 }}><ProgressBar progress={prog} /></div>
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

                {/* 本場其他囚犯(非我看守的) */}
                {(() => {
                  const mineIds = new Set(myInmates.map(r => r.id))
                  const others = allInmates.filter(r => !mineIds.has(r.id))
                  return (
                    <>
                      <div className="subgroup">本場其他囚犯 ({others.length})<span className="ln" /></div>
                      {others.length === 0 ? (
                        <p className="empty">沒有其他囚犯</p>
                      ) : others.map(c => {
                        const status = presence(c)
                        const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['等待中']
                        return (
                          <div key={c.id} className="inmate">
                            <div className="in-av">
                              {c.profile?.avatar_url ? <img src={c.profile.avatar_url} alt="" />
                                : (c.profile?.game_name ?? c.profile?.display_name ?? '?')[0]}
                            </div>
                            <div>
                              <div className="in-nm">{c.profile?.game_name ?? c.profile?.display_name ?? '（未知）'}</div>
                              <div className="in-no">No.{c.profile?.inmate_no != null ? String(c.profile.inmate_no).padStart(4, '0') : '----'}</div>
                            </div>
                            <span className="spacer" />
                            {status && <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>}
                          </div>
                        )
                      })}
                    </>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* === 本場廣播(指定由我執行的,唯讀) === */}
          <SessionVisits sessionId={session.id} userId={userId} role="guard" />

          {/* === 底部:本場獄卒(頭貼格狀,同犯人端) === */}
          <div className="card-panel">
            <div className="head"><h2>本場獄卒</h2>{allGuards.length > 0 && <span className="count">{allGuards.length} 位</span>}</div>
            <div className="body">
              {allGuards.length === 0 ? (
                <p className="empty">本場目前沒有獄卒在場</p>
              ) : (
                <div className="guard-grid">
                  {allGuards.map(gd => (
                    <div key={gd.id} className="guard-cell">
                      <div className="g-av">
                        {gd.profile?.avatar_url ? <img src={gd.profile.avatar_url} alt="" />
                          : (gd.profile?.game_name ?? gd.profile?.display_name ?? '?')[0]}
                      </div>
                      <div className="g-nm">{gd.profile?.game_name ?? gd.profile?.display_name ?? '（未知）'}{gd.member_id === userId ? ' · 你' : ''}</div>
                      <span className="role-tag guard">{gd.profile?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
