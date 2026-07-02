import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ProgressBar, PRIORITY } from './ManuscriptManager'
import MessageBanner from './MessageBanner'
import SessionStatus from './SessionStatus'
import { computeProgress } from './progress'
import ProfileCard from './ProfileCard'
import SessionVisits from './SessionVisits'
import PersonalPomodoro from './PersonalPomodoro'
import { normalizeStatus } from './warden/constants'
import { slotLabel } from './slots'
import { priceMap, effPrice, fetchPriceRows } from './prices'

// 指名互動場的預約/購入顯示輔助
const gArr = (v) => (Array.isArray(v) ? v : [])
const ITEM_LABEL = { signup: '現場報名', visit: '互動探監', polaroid: '拍立得', portrait: '肖像畫', nominate: '指名時段', sign: '簽繪', entry: '入場' }
function posItemDesc(it) {
  if (it.item_type === 'polaroid') return `拍立得 ${it.qty ?? 0} 張${it.with_signature ? '（含簽繪）' : ''}`
  if (it.item_type === 'nominate') { const n = gArr(it.slot_times).length; return `指名時段${n ? ` ${n} 段` : ''}` }
  return ITEM_LABEL[it.item_type] ?? it.item_type
}

// 指名互動:「本場預約與購入」面板(取代番茄鐘位置)。
// 依獄卒分組:每卒一欄列出 預約時段/加購/現場購入 + 小計;欄多可左右滑動,底部分隔線後的
// 指名費用/拍立得費用/合計 固定不隨滑動。預約列金額以價目表估算(生效價),購入列用 POS 實收。
function NamedPurchasePanel({ session, myBooking, myItems, bkGuardName, priceRows }) {
  const pm = priceMap(priceRows)
  const P = (key) => effPrice(pm[`named|${key}`])
  const gname = (id) => bkGuardName[id] ?? '（獄卒）'
  const groups = new Map()
  const grp = (name) => {
    if (!groups.has(name)) groups.set(name, { name, lines: [], subtotal: 0 })
    return groups.get(name)
  }
  let nominateTotal = 0, polaroidTotal = 0, otherTotal = 0
  // 預約時段(依獄卒彙整)
  const slotsByG = {}
  for (const x of gArr(myBooking?.requested_slots)) if (x.s != null) (slotsByG[x.g] ??= []).push(Number(x.s))
  for (const [gid, ss] of Object.entries(slotsByG)) {
    const amt = P('nominate') * ss.length
    const g = grp(gname(gid))
    g.lines.push({ tag: '預約', desc: `預約時段 ${ss.sort((a, b) => a - b).map(s => slotLabel(session.start_time, s)).join('、')}`, amt })
    g.subtotal += amt; nominateTotal += amt
  }
  // 預約加購(拍立得/簽繪/肖像畫)
  for (const a of gArr(myBooking?.addons)) {
    if (!a) continue
    const g = grp(gname(a.g))
    if ((a.polaroid || 0) > 0) {
      const amt = (P('polaroid') + (a.sign ? P('sign') : 0)) * a.polaroid
      g.lines.push({ tag: '預約', desc: `拍立得${a.sign ? '（含簽繪）' : '（空白）'} x${a.polaroid}`, amt })
      g.subtotal += amt; polaroidTotal += amt
    }
    if ((a.portrait || 0) > 0) {
      const amt = P('portrait') * a.portrait
      g.lines.push({ tag: '預約', desc: `肖像畫 x${a.portrait}`, amt })
      g.subtotal += amt; otherTotal += amt
    }
  }
  // 現場購入(POS 實收)
  for (const it of myItems) {
    const g = grp(it.guard_name || '未指定獄卒')
    const amt = it.amount ?? 0
    g.lines.push({ tag: '購入', desc: posItemDesc(it), amt })
    g.subtotal += amt
    if (it.item_type === 'nominate') nominateTotal += amt
    else if (it.item_type === 'polaroid') polaroidTotal += amt
    else otherTotal += amt
  }
  const total = nominateTotal + polaroidTotal + otherTotal
  return (
    <div className="card-panel sg-buypanel">
      <div className="head"><h2>本場預約與購入</h2><span className="count">指名互動</span></div>
      <div className="body">
        {groups.size === 0 ? <p className="empty">本場尚無預約或購入紀錄</p> : (
          <div className="sg-buy-scroll">
            {[...groups.values()].map(g => (
              <div key={g.name} className="sg-buy-col">
                <div className="sg-buy-guard">🛡 {g.name}</div>
                {g.lines.map((l, i) => (
                  <div key={i} className="sg-buy-line">
                    <span className={`sb-tag ${l.tag === '預約' ? 'bk' : 'pos'}`}>{l.tag}</span>
                    <span className="sb-desc">{l.desc}</span>
                    <span className="sb-amt mono">{l.amt} 萬</span>
                  </div>
                ))}
                <div className="sg-buy-sub"><span>小計</span><span className="mono">{g.subtotal} 萬</span></div>
              </div>
            ))}
          </div>
        )}
        <div className="sg-buy-summary">
          {nominateTotal > 0 && <div className="sg-buy-srow"><span>指名費用</span><span className="mono">{nominateTotal} 萬</span></div>}
          {polaroidTotal > 0 && <div className="sg-buy-srow"><span>拍立得費用</span><span className="mono">{polaroidTotal} 萬</span></div>}
          {otherTotal > 0 && <div className="sg-buy-srow"><span>其他費用</span><span className="mono">{otherTotal} 萬</span></div>}
          <div className="sg-buy-srow total"><span>合計</span><span className="mono">{total} 萬</span></div>
        </div>
      </div>
    </div>
  )
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
  const [guards, setGuards] = useState([])        // 本場獄卒(role=guard/warden)
  const [myGuards, setMyGuards] = useState([])    // 我的專屬獄卒(inmate_guards)
  const [myItems, setMyItems] = useState([])              // 指名互動:我的 POS 購入明細(本場)
  const [myBooking, setMyBooking] = useState(null)        // 指名互動:我的本場預約(時段/加購/抓捕)
  const [bkGuardName, setBkGuardName] = useState({})      // 預約牽涉的獄卒 id → 名字
  const [nominated, setNominated] = useState([])          // 指名互動:我預約時段指名的獄卒 profiles(獄卒欄位顯示用)
  const [priceRows, setPriceRows] = useState(null)        // 價目表(指名場估算預約金額用;null=未載)
  const [newGoalTitle, setNewGoalTitle] = useState('')    // 新增本場目標 modal:手動新建稿件標題
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
        .select('id, title, status, timer_started_at, timer_ended_at, total_rounds, kind, start_time')
        .in('id', si.map(r => r.session_id))
      const live = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended')
      sess = live[0] ?? null
      if (sess) mine = si.find(r => r.session_id === sess.id)
    }
    // 自助入場:未報到但有未取消預約的 live 場 → self_check_in 建立本場身分(免典獄長報到/身分核對)
    if (!mine) {
      const { data: bk } = await supabase.from('bookings')
        .select('session_id').eq('user_id', userId).neq('status', 'cancelled')
      const bookedIds = [...new Set((bk ?? []).map(b => b.session_id))]
      if (bookedIds.length) {
        const { data: rows } = await supabase.from('sessions')
          .select('id, title, status, timer_started_at, timer_ended_at, total_rounds, kind, start_time').in('id', bookedIds)
        const target = (rows ?? []).filter(s => normalizeStatus(s) !== 'ended')[0] ?? null
        if (target) {
          await supabase.rpc('self_check_in', { p_session: target.id })
          const { data: si2 } = await supabase.from('session_inmates')
            .select('id, session_id, state').eq('member_id', userId).eq('session_id', target.id)
          if (si2 && si2.length) { mine = si2[0]; sess = target }
        }
      }
    }
    setSession(sess); setMyInmate(mine)
    if (!mine) { setGoals([]); setActives([]); setStepsByMs({}); setLoading(false); return }

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

    // 指名互動場額外資料:我的本場預約(時段/加購)+ 我的 POS 購入明細 + 價目表(估算預約金額)
    if (sess.kind === 'named') {
      const [{ data: bk }, { data: pos }, prices] = await Promise.all([
        supabase.from('bookings').select('requested_slots, addons, capture, status')
          .eq('user_id', userId).eq('session_id', sess.id).neq('status', 'cancelled'),
        supabase.rpc('my_pos_items'),
        fetchPriceRows(),
      ])
      setPriceRows(prices)
      const booking = (bk ?? [])[0] ?? null
      const items = (pos ?? []).filter(p => p.session_id === sess.id)
      const gIds = [...new Set([
        ...gArr(booking?.requested_slots).map(x => x.g),
        ...gArr(booking?.addons).map(x => x.g),
      ].filter(Boolean))]
      const gName = {}, gProf = {}
      if (gIds.length) {
        const { data: gp } = await supabase.from('profiles').select('id, game_name, display_name, avatar_url, role').in('id', gIds)
        for (const p of gp ?? []) { gName[p.id] = p.game_name ?? p.display_name; gProf[p.id] = p }
      }
      // 我指名的獄卒(預約時段的對象;獄卒欄位顯示用,沒有即顯示「未指名」)
      const nomIds = [...new Set(gArr(booking?.requested_slots).filter(x => x.s != null).map(x => x.g).filter(Boolean))]
      setNominated(nomIds.map(id => gProf[id]).filter(Boolean))
      setMyBooking(booking); setMyItems(items); setBkGuardName(gName)
    } else {
      setMyBooking(null); setMyItems([]); setBkGuardName({}); setNominated([])
    }
    setLoading(false)
  }
  useEffect(() => { if (userId) load() }, [userId])

  // 本場獄卒一覽(供底部「本場獄卒」顯示)。稿件不再對同場犯人公開,故不載入同囚稿件/目標。
  async function loadCellmates(sessionId, myMemberId) {
    const { data: si } = await supabase.from('session_inmates')
      .select('id, member_id, role_in_session').eq('session_id', sessionId).neq('member_id', myMemberId)
    const guardRows = (si ?? []).filter(r => r.role_in_session === 'guard')
    if (!guardRows.length) { setGuards([]); return }
    const { data: profs } = await supabase.from('profiles')
      .select('id, game_name, display_name, avatar_url, role').in('id', guardRows.map(r => r.member_id))
    const profById = {}; for (const p of profs ?? []) profById[p.id] = p
    setGuards(guardRows.map(r => ({ siId: r.id, roleInSession: r.role_in_session, profile: profById[r.member_id] })))
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

  // 手動新建稿件並直接加入本場目標(不必先跳「我的稿件」;新稿同步進「我的稿件」)
  async function createAndAddGoal() {
    const title = newGoalTitle.trim()
    if (!title) { setMsg('目標名稱必填'); return }
    const { data, error } = await supabase.from('manuscripts')
      .insert({ member_id: userId, title, priority: 2, visibility: 'staff' })
      .select('id').single()
    if (error) { setMsg('新建失敗：' + error.message); return }
    setNewGoalTitle('')
    await addGoal(data.id)   // 直接加入本場;load(true) 會刷新 actives(即同步我的稿件清單)
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
  const waiting = ds !== 'serving'   // 尚未開始服刑(報名即可先進頁):本場目標仍可編輯,僅多一個提示徽章
  const isFree = session.kind === 'free'   // 自由入場:無獄卒相關資訊(專屬獄卒/本場獄卒/本場廣播)
  const isNamed = session.kind === 'named' // 指名互動:無本場廣播;番茄鐘位置改顯示本場預約與購入,順序 本場獄卒 → 本場目標

  // 可挑選 = active 稿件中,尚未挑進本場的
  const goalIds = goals.map(g => g.manuscript_id)
  const available = actives.filter(m => !goalIds.includes(m.id))

  // 獄卒欄位:指名互動顯示「我指名的獄卒」(沒指名落回典獄長指派;都沒有 → 未指名),其餘場次顯示專屬獄卒
  const guardLbl = isNamed ? '指名獄卒' : '專屬獄卒'
  const guardCards = (isNamed && nominated.length ? nominated : myGuards.map(g => g.profile)).filter(Boolean)

  // 本場獄卒面板(指名互動排在本場目標之前,其餘場次照舊排最底;抽成變數兩處共用)
  const guardsPanel = (
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
  )

  return (
    <div className="sg-page">
      <MessageBanner msg={msg} onClose={() => setMsg('')} />

      {/* === 上排:我 + 專屬獄卒 + 計時器(主角)。自由入場無獄卒相關資訊,不顯示專屬獄卒卡。 === */}
      <div className={`ses-top prisoner${isFree ? ' free' : ''}`}>
        {/* 我(直式身分卡,沿用 ProfileCard 的個人資料來源 + 編輯) */}
        <ProfileCard userId={userId} variant="id" label="我 · 服刑中" editable={false} />

        {/* 專屬獄卒(直式卡;骨架與 ProfileCard variant="id" 一致:id-av / id-lbl / id-no / id-nm / id-watch,
            缺的欄位以 &nbsp; + 既有 min-height 留白佔位;底部以 id-spacer(margin-top:auto)推齊讓並排卡片對齊) */}
        {isFree ? null : guardCards.length > 0 ? (
          <div className="idcard-stack">
            {guardCards.map((p, i) => (
              <div key={p?.id ?? i} className="idcard">
                <div className="id-av">
                  {p?.avatar_url
                    ? <img src={p.avatar_url} alt="" />
                    : (p?.game_name ?? p?.display_name ?? '?')[0]}
                </div>
                <div className="id-lbl">{guardLbl}</div>
                <div className="id-no">{' '}</div>
                <div className="id-nm">
                  {p?.game_name ?? p?.display_name ?? '（未知）'}
                  <span className="role-tag guard">{p?.role === 'warden' ? '典獄長' : '獄卒'}</span>
                </div>
                <div className="id-watch">👁 {isNamed ? '本場為你服務' : '正在看著你服刑'}</div>
                <div className="id-spacer" aria-hidden="true">&nbsp;</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="idcard">
            <div className="id-av">？</div>
            <div className="id-lbl">{guardLbl}</div>
            <div className="id-no">{' '}</div>
            <div className="id-nm muted">{isNamed ? '未指名' : '尚未配對'}</div>
            <div className="id-watch">&nbsp;</div>
            <div className="id-spacer" aria-hidden="true">&nbsp;</div>
          </div>
        )}

        {/* 第三欄:集體趕稿=全場番茄鐘;自由入場=個人番茄鐘(自行啟用);指名互動=本場預約與購入 */}
        {isFree ? <PersonalPomodoro title={`本場：${session.title}`} />
          : isNamed ? <NamedPurchasePanel session={session} myBooking={myBooking} myItems={myItems} bkGuardName={bkGuardName} priceRows={priceRows} />
          : <SessionStatus userId={userId} />}
      </div>

      {/* 指名互動:本場獄卒排在本場目標之前 */}
      {isNamed && guardsPanel}

      {/* 本場目標(稿件不對同場犯人公開,已移除本場囚犯同囚清單) */}
      <div className="card-panel">
        <div className="head">
          <h2>本場目標</h2>
          {goals.length > 0 && <span className="count">{goals.length} 項</span>}
          {waiting && <span className="hint-badge">等待開始服刑，可先挑選本場目標</span>}
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

      {/* === 本場廣播(探望我的,唯讀)。自由入場無獄卒相關資訊、指名互動無本場廣播,皆不顯示。 === */}
      {!isFree && !isNamed && <SessionVisits sessionId={session.id} userId={userId} role="inmate" />}

      {/* === 底部:本場獄卒(頭貼格狀;自由入場無獄卒不顯示;指名互動已移至本場目標之前) === */}
      {!isFree && !isNamed && guardsPanel}

      {/* 新增本場目標 modal:把原本 inline 挑稿清單搬進 modal,挑稿沿用既有 addGoal,可連續挑多筆。
          available 即時依 goals/actives 重算(挑進來的稿自動從清單移除)。 */}
      {goalModalOpen && (
        <div className="admin-modal-bg" onClick={() => setGoalModalOpen(false)}>
          <div className="admin-modal goal-modal" onClick={e => e.stopPropagation()}>
            <div className="goal-modal-head">
              <h3>新增本場目標</h3>
              <button className="goal-modal-x" onClick={() => setGoalModalOpen(false)}>✕</button>
            </div>
            {/* 手動新建目標:直接建稿並加入本場,不必先跳「我的稿件」;新稿會同步進「我的稿件」 */}
            <form className="goal-new" onSubmit={e => { e.preventDefault(); createAndAddGoal() }}>
              <input className="goal-new-input" value={newGoalTitle} onChange={e => setNewGoalTitle(e.target.value)}
                placeholder="手動填新目標（直接建立並加入本場）" maxLength={60} />
              <button type="submit" className="btn-pri" disabled={!newGoalTitle.trim()}>＋ 建立並加入</button>
            </form>

            <div className="goal-new-or">或從「我的稿件」挑選</div>
            {available.length === 0 ? (
              <div className="goal-modal-empty">
                <p className="warn">沒有其他可加入的稿件了</p>
                {onGoToManuscripts && (
                  <button className="btn-sm" onClick={() => { setGoalModalOpen(false); onGoToManuscripts() }}>前往我的稿件</button>
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
