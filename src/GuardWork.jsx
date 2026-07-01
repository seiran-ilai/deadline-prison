import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import { ProgressBar } from './ManuscriptManager'
import { computeProgress, goalStatusLabel } from './progress'
import SessionStatus from './SessionStatus'
import SessionMemoPanel from './SessionMemoPanel'
import SessionVisits from './SessionVisits'
import ProfileCard from './ProfileCard'
import { normalizeStatus } from './warden/constants'
import { SESSION_KIND_LABEL } from './sessionKind'
import { slotLabel } from './slots'

// 犯人列狀態 chip 樣式:只承載「目標完成度」三態,不再呈現番茄鐘(專注/放風)。
const PRESENCE_STYLE = {
  '服刑完畢': { bg: '#666', color: '#fff' },                       // 完成:深灰
  '服刑中': { bg: '#d9534f', color: '#fff' },                      // 進行中:警示紅
  '尚未挑稿': { bg: 'rgba(255,255,255,.08)', color: '#9298a2' },   // 沒挑目標:次要灰
}

// 指名互動場:犯人的預約內容 / POS 購入顯示輔助
const gArr = (v) => (Array.isArray(v) ? v : [])
const ITEM_LABEL = { signup: '現場報名', visit: '互動探監', polaroid: '拍立得', portrait: '肖像畫', nominate: '指名時段', sign: '簽繪', entry: '入場' }
function posItemDesc(it) {
  if (it.item_type === 'polaroid') return `拍立得 ${it.qty ?? 0} 張${it.with_signature ? '（含簽繪）' : ''}`
  if (it.item_type === 'nominate') { const n = gArr(it.slot_times).length; return `指名時段${n ? ` ${n} 段` : ''}` }
  return ITEM_LABEL[it.item_type] ?? it.item_type
}
// 該品項可勾的核對項(與典獄長「今日營業總表」同一組 status 欄位)
function statusFields(it) {
  const f = []
  if (it.item_type === 'polaroid') f.push(['status_polaroid', '拍立得'])
  if (it.item_type === 'visit' || it.item_type === 'nominate' || (it.item_type === 'signup' && it.supervise)) f.push(['status_interact', '互動'])
  if (it.item_type === 'visit') f.push(['status_photo', '合照'])
  return f
}

// 獄卒作業頁:場次切換 → 狀態階段 → 監管犯人名單(+目標代勾) → 本場獄卒一覽 → 本場犯人一覽
export default function GuardWork({ userId }) {
  const [loading, setLoading] = useState(true)
  const [liveSessions, setLiveSessions] = useState([]) // 我可看守的未結束場次(可切換)
  const [selSid, setSelSid] = useState(null)           // 目前選的場次 id
  const selRef = useRef(null)                          // 讓 10 秒輪詢讀到最新選擇(由 refresh/pickSession 維護)
  const [session, setSession] = useState(null)
  const [myInmate, setMyInmate] = useState(null)   // 我在本場的 session_inmates 記錄(僅排班則為合成)
  const [allGuards, setAllGuards] = useState([])    // 本場 role_in_session='guard'
  const [allInmates, setAllInmates] = useState([])  // 本場 role_in_session='inmate'
  const [myInmates, setMyInmates] = useState([])    // 指派給我的犯人(含本場目標+進度)
  const [stepsByMs, setStepsByMs] = useState({})    // manuscript_id -> [steps]
  const [expanded, setExpanded] = useState([])      // 展開中的目標(session_goals.id)
  const [posItems, setPosItems] = useState([])       // 指名互動:本場 POS 購入(含本單犯人名)
  const [bookingByMember, setBookingByMember] = useState({}) // 指名互動:member_id → 預約內容
  const [msg, setMsg] = useState('')

  // 我可看守的未結束場次:以獄卒身分報到(session_inmates)∪ 當日排班(session_guards)
  async function loadList() {
    const [{ data: si }, { data: sg }] = await Promise.all([
      supabase.from('session_inmates').select('session_id, role_in_session').eq('member_id', userId),
      supabase.from('session_guards').select('session_id').eq('guard_id', userId),
    ])
    const sids = new Set([
      ...(si ?? []).filter(r => r.role_in_session === 'guard').map(r => r.session_id),
      ...(sg ?? []).map(r => r.session_id),
    ])
    if (!sids.size) { setLiveSessions([]); return [] }
    const { data: rows } = await supabase.from('sessions')
      .select('id, title, status, timer_started_at, timer_ended_at, total_rounds, kind, start_time').in('id', [...sids])
    const live = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended').sort((a, b) => (a.title > b.title ? 1 : -1))
    setLiveSessions(live)
    return live
  }

  // 一次刷新:更新可切換場次清單 + 目前選定場次的名單/目標/POS
  async function refresh(silent) {
    if (!silent) setLoading(true)
    const live = await loadList()
    let sid = selRef.current
    if (!live.find(s => s.id === sid)) sid = live[0]?.id ?? null   // 選定場次已結束/未選 → 落回第一個
    if (sid !== selRef.current) { selRef.current = sid; setSelSid(sid) }
    await loadSession(live.find(s => s.id === sid) ?? null)
    setLoading(false)
  }

  // 切換場次(即時載入,不等輪詢)
  function pickSession(sid) {
    selRef.current = sid; setSelSid(sid)
    loadSession(liveSessions.find(s => s.id === sid) ?? null)
  }

  async function loadSession(sess) {
    if (!sess) {
      setSession(null); setMyInmate(null)
      setAllGuards([]); setAllInmates([]); setMyInmates([]); setStepsByMs({}); setPosItems([]); setBookingByMember({})
      return
    }
    // 我在本場的記錄(僅排班而無 session_inmates 列時,合成 guard 身分供在場判定)
    const { data: myRow } = await supabase.from('session_inmates')
      .select('id, role_in_session, state').eq('member_id', userId).eq('session_id', sess.id).maybeSingle()
    const mine = myRow ?? { id: null, role_in_session: 'guard', state: null }
    setSession(sess); setMyInmate(mine)

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

    // 5) 指名互動場:本場 POS 購入 + 預約內容(獄卒讀不到別人的原表,走 security definer RPC 兜底)
    if (sess.kind === 'named') {
      const [{ data: pos }, { data: bks }] = await Promise.all([
        supabase.rpc('session_pos_items', { p_session: sess.id }),
        supabase.rpc('session_bookings_view', { p_session: sess.id }),
      ])
      setPosItems(pos ?? [])
      const bm = {}
      for (const b of bks ?? []) if (b.status !== 'cancelled') bm[b.user_id] = b
      setBookingByMember(bm)
    } else {
      setPosItems([]); setBookingByMember({})
    }
  }

  // 每 10 秒輪詢(接收典獄長報到/指派/開始;同時更新可切換場次清單)
  useEffect(() => {
    if (!userId) return
    let alive = true
    refresh(false)
    const t = setInterval(() => { if (alive) refresh(true) }, 10000)   // 首次顯示 loading,之後靜默輪詢
    return () => { alive = false; clearInterval(t) }
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

  // 指名互動:獄卒勾選 POS 核對項(互動/合照/拍立得)→ 與典獄長「今日營業總表」同一筆同步(樂觀更新)
  async function togglePosStatus(item, field) {
    const next = !item[field]
    setPosItems(prev => prev.map(x => x.id === item.id ? { ...x, [field]: next } : x))
    const { error } = await supabase.rpc('set_pos_item_status', { p_item: item.id, p_field: field, p_value: next })
    if (error) {
      setPosItems(prev => prev.map(x => x.id === item.id ? { ...x, [field]: !next } : x))
      setMsg('更新失敗：' + error.message)
    }
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

  // 指名互動:本場獄卒 id → 名字(解析預約時段的指名獄卒)
  // 指名互動場「我的服務對象」:凡指名/購買到我的犯人(POS target=我)∪ 指派給我的犯人,
  // 每位彙整:預約時段(我被指名的時格)/ 購買項目 / 目標稿件(可代勾,與犯人端雙邊同步)。
  const serveTargets = []
  if (session?.kind === 'named') {
    const byName = {}
    for (const it of posItems) {
      if (it.guard_id !== userId) continue
      const key = it.customer_name || it.person_name || '（未指定）'
      ;(byName[key] ??= { name: key, items: [], slots: [] }).items.push(it)
      if (it.item_type === 'nominate') byName[key].slots.push(...gArr(it.slot_times))
    }
    for (const c of myInmates) {   // 指派給我但尚無 POS 的犯人也列入
      const nm = c.profile?.game_name || c.profile?.display_name
      if (nm && !byName[nm]) byName[nm] = { name: nm, items: [], slots: [] }
    }
    for (const t of Object.values(byName)) {
      const inmate = allInmates.find(c => {
        const s = new Set([c.profile?.game_name, c.profile?.display_name].filter(Boolean))
        return s.has(t.name)
      })
      let slots = [...new Set(t.slots)]
      if (inmate && bookingByMember[inmate.member_id]) {   // 官網預約指名我的時段一併納入
        const bs = gArr(bookingByMember[inmate.member_id].requested_slots).filter(x => x.g === userId && x.s != null).map(x => Number(x.s))
        slots = [...new Set([...slots, ...bs])]
      }
      slots.sort((a, b) => a - b)
      serveTargets.push({ ...t, slots, inmate })
    }
  }

  // 目標稿件列(集體/指名共用:進度條 + 展開子項目代勾)
  const goalList = (goals) => goals.map(g => {
    const steps = stepsByMs[g.manuscript_id] ?? []
    const prog = computeProgress({ steps, isDone: g.manuscript?.is_done })
    const isOpen = expanded.includes(g.id)
    return (
      <div key={g.id} className="gw-goal">
        <div className="gw-goal-hd">
          <span className="gw-goal-nm">{g.manuscript?.title ?? '（保密作業）'}</span>
          <div className="gw-goal-bar"><ProgressBar progress={prog} /></div>
          <button className="btn-sm" onClick={() => toggleExpand(g.id)}>{isOpen ? '收合' : '展開'}</button>
        </div>
        {isOpen && (
          <div className="substeps">
            {steps.length === 0 ? <p className="empty">這本稿還沒有子項目</p>
              : steps.map(s => (
                <div key={s.id} className="step">
                  <input type="checkbox" checked={s.done} onChange={() => toggleStep(s)} />
                  <span className={s.done ? 'done-text' : ''}>{s.title}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    )
  })

  // 防呆:userId 尚未就緒(首次登入流程)時不掛載
  if (!userId) return null

  return (
    <div>
      {loading ? (
        <p className="empty">讀取獄卒作業中…</p>
      ) : (
      <>
      {msg && <div className="banner err">{msg}</div>}

      {/* 場次切換:同時在多個未結束場次看守時可切換(不只集體趕稿,指名互動亦適用) */}
      {liveSessions.length > 1 && (
        <div className="gw-switch">
          <span className="gw-switch-lbl">切換場次</span>
          {liveSessions.map(s => (
            <button key={s.id} type="button" className={`gw-switch-btn k-${s.kind || 'crunch'}${s.id === selSid ? ' on' : ''}`} onClick={() => pickSession(s.id)}>
              <span className="gw-kind">{SESSION_KIND_LABEL[s.kind] ?? '集體趕稿'}</span>
              <span className="gw-title">{s.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* === 上排:我(獄卒) + 計時器 / (指名場)本場 MEMO 填右欄 === */}
      <div className="ses-top guard">
        <ProfileCard userId={userId} variant="id" label="我 · 看守中" editable={false}
          footer={myInmate ? <div className="id-watch">👁 專屬看守 {myInmates.length} 人 · 本場共 {allInmates.length} 人</div> : null} />
        {/* 指名互動無番茄鐘:右欄改放本場 MEMO(免留空);集體/自由顯示番茄鐘狀態卡(用本場資料算,不自載) */}
        {session?.kind === 'named'
          ? (myInmate && <SessionMemoPanel userId={userId} session={session} />)
          : <SessionStatus userId={userId} session={session ?? null} />}
      </div>

      {/* ended 防呆提示(外層一般已擋已結束場次,保險起見;名單維持顯示供獄卒收尾檢視) */}
      {session && normalizeStatus(session) === 'ended' && (
        <div className="banner">本場已結束</div>
      )}

      {!myInmate ? (
        <div className="card-panel"><div className="body">
          <p className="empty" style={{ textAlign: 'center' }}>你目前不在任何進行中的場次，請等待典獄長將你加入為本場獄卒</p>
        </div></div>
      ) : (
        <>
          {/* 指名互動:我的服務對象(全寬主體,MEMO 已移到上排);其餘場次:MEMO + 本場囚犯兩欄 */}
          {session.kind === 'named' ? (
            <div className="card-panel">
              <div className="head"><h2>我的服務對象</h2><span className="count">指名 {serveTargets.length} 位</span></div>
              <div className="body">
                {serveTargets.length === 0 ? <p className="empty">目前沒有指名你的犯人</p> : (
                  <div className="serve-list">
                    {serveTargets.map((t, i) => {
                      const status = t.inmate ? presence(t.inmate) : null
                      const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['尚未挑稿']
                      return (
                        <div key={i} className="serve-card">
                          <div className="serve-head">
                            <span className="serve-nm">{t.name}</span>
                            {t.inmate?.profile?.inmate_no != null && <span className="serve-no mono">No.{String(t.inmate.profile.inmate_no).padStart(4, '0')}</span>}
                            <span className="spacer" />
                            {status && <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>}
                          </div>
                          <div className="serve-row"><span className="serve-k">預約時段</span>
                            <span className="serve-v">{t.slots.length ? t.slots.map(s => slotLabel(session.start_time, s)).join('、') : <span className="faint">—</span>}</span></div>
                          <div className="serve-row goals"><span className="serve-k">購買項目</span>
                            <div className="serve-buys">
                              {t.items.length === 0 ? <span className="faint">—</span> : t.items.map((it, j) => {
                                const fields = statusFields(it)
                                return (
                                  <div key={it.id ?? j} className="serve-buy">
                                    <span className="sb-name">{posItemDesc(it)}{it.amount ? `（${it.amount} 萬）` : ''}</span>
                                    {fields.length === 0 ? <span className="faint sb-na">無需確認</span>
                                      : fields.map(([f, lbl]) => (
                                        <label key={f} className={`sb-chk${it[f] ? ' on' : ''}`}>
                                          <input type="checkbox" checked={!!it[f]} onChange={() => togglePosStatus(it, f)} />{lbl}完成
                                        </label>
                                      ))}
                                  </div>
                                )
                              })}
                            </div></div>
                          <div className="serve-row goals"><span className="serve-k">目標稿件</span>
                            <div className="serve-goals">
                              {!t.inmate ? <span className="faint">非本場登記犯人，無目標稿件</span>
                                : t.inmate.goals.length === 0 ? <span className="faint">本場還沒挑目標</span>
                                  : goalList(t.inmate.goals)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="ses-mid">
              {/* 本場 MEMO · 確認項 */}
              <SessionMemoPanel userId={userId} session={session} />
              {/* 本場囚犯(集體趕稿):我看守的置頂高亮 + 其餘分組 */}
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
          )}

          {/* === 本場廣播(指定由我執行的,唯讀)=== 指名互動無探監廣播,不顯示 */}
          {session.kind !== 'named' && (
            <SessionVisits sessionId={session.id} userId={userId} role="guard" />
          )}

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
