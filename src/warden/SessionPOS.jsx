import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { slotLabel } from '../slots'

// 進行中場次 統一 POS 開單:選品項(chip)→ 該品項專屬細節 → 加入本單(購物車)→ 一次結帳寫入營業額。
// 取代舊「走查加購 / 臨時追加犯人 / 探監登錄」三個攤開表單。
// 資料來源沿用現有結構(分開查詢再 JS 合併):
//   上班獄卒/角色(監督·肖像)/可指名時格 ← session_guards(slots) + profiles(portrait_only)
//   本場犯人名單 ← bookings(未取消)
//   時格占用 ← bookings.requested_slots ∪ guard_slot_bookings(兩邊都查)
// 結帳寫 pos_orders(paid=true)+ pos_order_items;臨時指定時格另寫 guard_slot_bookings。金額單位:萬。
const PRICE = { signup: 20, supervise: 10, visit: 5, polaroid: 5, sign: 3, portrait: 80, nominate: 15, entry: 1 }   // visit 試營運限定 5 萬(獄卒實拿 5、監獄不抽)
const ITEM_LABEL = { signup: '臨時報名', visit: '互動探監', polaroid: '拍立得', portrait: '肖像畫', nominate: '臨時指定', entry: '無指名入場' }
const arr = v => Array.isArray(v) ? v : []
const money = n => `${n} 萬`

const EMPTY_D = { person_name: '', target_guard_id: '', qty: 1, with_signature: false, visitor_name: '', message: '', interaction_note: '', supervise: false, slot_times: [], assign_guard_id: '' }

export default function SessionPOS({ session, inmates, setMsg, onPosChange }) {
  const sid = session?.id
  const kind = session?.kind
  const [guards, setGuards] = useState([])     // 上班獄卒 [{id,name,portrait_only,slots:number[]}]
  const [rosterNames, setRosterNames] = useState([]) // 本場犯人名稱(下拉/快速帶入)
  const [occupied, setOccupied] = useState(new Set()) // "guardId|slotIdx"
  const [items, setItems] = useState([])       // 今日 pos_order_items
  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState('') // 指名場本單犯人名稱
  const [customerServer, setCustomerServer] = useState('') // 臨時報名犯人伺服器(暱稱/伺服器分欄;自動建號用)
  const [orderNote, setOrderNote] = useState('') // 結帳備註
  const [ordersById, setOrdersById] = useState({}) // order_id -> { customer_name, note }
  const [pick, setPick] = useState('')         // 目前選的品項 key
  const [d, setD] = useState(EMPTY_D)          // 品項細節暫存
  const [cart, setCart] = useState([])         // 本單購物車
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null) // 待確認刪除的 item id(inline 確認,不用 window.confirm)
  const [sortKey, setSortKey] = useState(null)       // 今日營業總表排序欄(null=依結帳時間)
  const [sortDir, setSortDir] = useState('desc')
  const [onlyUndone, setOnlyUndone] = useState(false) // 只顯示未完成

  const guardName = id => guards.find(g => g.id === id)?.name ?? '獄卒'

  async function load() {
    if (!sid) return
    setLoading(true)
    const byId = {}; for (const p of inmates) byId[p.id] = p
    const { data: sg } = await supabase.from('session_guards').select('guard_id, slots').eq('session_id', sid)
    setGuards((sg ?? []).map(r => {
      const p = byId[r.guard_id]
      return { id: r.guard_id, name: p?.game_name || p?.display_name || '獄卒', portrait_only: !!p?.portrait_only, slots: arr(r.slots), inmate_no: p?.inmate_no ?? 1e9 }
    }).sort((a, b) => a.inmate_no - b.inmate_no))   // 獄卒一律依犯人編號排序
    const { data: bk } = await supabase.from('bookings')
      .select('game_name, dc_name, requested_slots, status').eq('session_id', sid).neq('status', 'cancelled')
    setRosterNames([...new Set((bk ?? []).map(b => b.game_name || b.dc_name).filter(Boolean))])
    // 占用:官網預約 requested_slots(s!=null) ∪ guard_slot_bookings
    const occ = new Set()
    for (const b of bk ?? []) for (const p of arr(b.requested_slots)) if (p?.g && p.s != null) occ.add(`${p.g}|${p.s}`)
    const { data: gsb } = await supabase.from('guard_slot_bookings').select('guard_id, slot_index').eq('session_id', sid)
    for (const r of gsb ?? []) occ.add(`${r.guard_id}|${r.slot_index}`)
    setOccupied(occ)
    const { data: it } = await supabase.from('pos_order_items')
      .select('id, order_id, item_type, person_name, target_guard_id, qty, with_signature, amount, visitor_name, message, interaction_note, supervise, slot_times, status_interact, status_photo, status_polaroid, created_at')
      .eq('session_id', sid).order('created_at', { ascending: false })
    setItems(it ?? [])
    const { data: ords } = await supabase.from('pos_orders').select('id, customer_name, note').eq('session_id', sid)
    const om = {}; for (const o of ords ?? []) om[o.id] = { customer_name: o.customer_name, note: o.note }
    setOrdersById(om)
    setLoading(false)
  }
  useEffect(() => { load() }, [sid])

  const onDuty = useMemo(() => guards.filter(g => !g.portrait_only), [guards])
  const portraitGuards = useMemo(() => guards.filter(g => g.portrait_only), [guards])
  const hasPortrait = portraitGuards.length > 0
  const chips = kind === 'named'
    ? [['nominate', false], ['entry', false], ['polaroid', false], ['portrait', !hasPortrait]]
    : [['signup', false], ['visit', false], ['polaroid', false], ['portrait', !hasPortrait]]

  // 某獄卒剩餘可接時格(排班可指名 − 占用 − 本單已選)
  const cartSlotKeys = new Set(cart.flatMap(c => c.item_type === 'nominate' ? arr(c.slot_times).map(s => `${c.target_guard_id}|${s}`) : []))
  const freeSlots = gid => {
    const g = guards.find(x => x.id === gid); if (!g) return []
    return g.slots.filter(s => !occupied.has(`${gid}|${s}`) && !cartSlotKeys.has(`${gid}|${s}`))
  }

  function choose(key, disabled) {
    if (disabled) return
    setPick(key); setD({ ...EMPTY_D })
  }

  // 目前細節能否加入 + 金額
  function currentLine() {
    const cust = customer.trim()   // 加購頂端「犯人名稱」= 本單對象(肖像畫/拍立得可留空)
    switch (pick) {
      case 'signup': {
        if (!cust) return { err: '請先填犯人名稱' }
        if (d.supervise && !d.target_guard_id) return { err: '請選監督獄卒' }
        // assign_guard_id:典獄長免費分配的專屬看守(不入 POS,結帳後寫 inmate_guards);與付費指名監督各自獨立
        return { line: { item_type: 'signup', person_name: cust, supervise: d.supervise, target_guard_id: d.supervise ? d.target_guard_id : null, assign_guard_id: d.assign_guard_id || null, amount: PRICE.signup + (d.supervise ? PRICE.supervise : 0) } }
      }
      case 'visit': {
        if (!cust) return { err: '請先填犯人名稱（探監對象）' }
        if (!d.visitor_name.trim()) return { err: '請填探監人名稱' }
        if (!d.target_guard_id) return { err: '請選執行獄卒' }
        return { line: { item_type: 'visit', visitor_name: d.visitor_name.trim(), person_name: cust, target_guard_id: d.target_guard_id, message: d.message.trim(), interaction_note: d.interaction_note.trim(), amount: PRICE.visit } }
      }
      case 'polaroid': {
        if (!d.target_guard_id) return { err: '請選對象獄卒' }
        const qty = Math.max(1, Math.min(99, parseInt(d.qty) || 1))
        return { line: { item_type: 'polaroid', person_name: cust || null, target_guard_id: d.target_guard_id, qty, with_signature: d.with_signature, amount: (PRICE.polaroid + (d.with_signature ? PRICE.sign : 0)) * qty } }
      }
      case 'portrait': {
        if (!d.target_guard_id) return { err: '請選負責獄卒' }
        return { line: { item_type: 'portrait', person_name: cust || null, target_guard_id: d.target_guard_id, amount: PRICE.portrait } }
      }
      case 'nominate': {
        if (!cust) return { err: '請先填犯人名稱' }
        if (!d.target_guard_id) return { err: '請選指名獄卒' }
        if (!d.slot_times.length) return { err: '請選至少一個時段' }
        return { line: { item_type: 'nominate', person_name: cust, target_guard_id: d.target_guard_id, slot_times: [...d.slot_times].sort((a, b) => a - b), amount: PRICE.nominate * d.slot_times.length } }
      }
      case 'entry':
        if (!cust) return { err: '請先填犯人名稱' }
        return { line: { item_type: 'entry', person_name: cust, amount: PRICE.entry } }
      default:
        return { err: '' }
    }
  }
  const cur = pick ? currentLine() : { err: '' }

  function addToCart() {
    if (cur.err || !cur.line) { if (cur.err) setMsg(cur.err); return }
    setCart(c => [...c, { ...cur.line, _k: Math.random().toString(36).slice(2) }])
    setPick(''); setD({ ...EMPTY_D })
  }
  const cartTotal = cart.reduce((s, c) => s + (c.amount || 0), 0)

  async function checkout() {
    if (!cart.length) return
    setBusy(true)
    const cust = customer.trim()
    const { data: order, error: oErr } = await supabase.from('pos_orders')
      .insert({ session_id: sid, customer_name: cust || null, note: orderNote.trim() || null }).select('id').single()
    if (oErr) { setBusy(false); setMsg('結帳失敗：' + oErr.message); return }
    const rows = cart.map(c => ({
      order_id: order.id, session_id: sid, item_type: c.item_type,
      person_name: c.person_name ?? null, target_guard_id: c.target_guard_id ?? null,
      qty: c.qty ?? null, with_signature: !!c.with_signature, amount: c.amount || 0,
      visitor_name: c.visitor_name ?? null, message: c.message ?? null, interaction_note: c.interaction_note ?? null,
      supervise: !!c.supervise, slot_times: arr(c.slot_times),
    }))
    const { data: inserted, error: iErr } = await supabase.from('pos_order_items')
      .insert(rows).select('id, order_id, item_type, person_name, target_guard_id, qty, with_signature, amount, visitor_name, message, interaction_note, supervise, slot_times, status_interact, status_photo, status_polaroid')
    if (iErr) { setBusy(false); setMsg('結帳失敗：' + iErr.message); return }
    // 臨時指定時格 → guard_slot_bookings(占位)
    const gsb = []
    for (const it of inserted ?? []) if (it.item_type === 'nominate') for (const s of arr(it.slot_times)) gsb.push({ session_id: sid, guard_id: it.target_guard_id, slot_index: s, order_item_id: it.id })
    if (gsb.length) await supabase.from('guard_slot_bookings').insert(gsb)
    // 臨時報名:建走查犯人(/api/walkin 自動建檔發號 + 暱稱/伺服器),名單沒有才追加;
    // 若該筆有「典獄長分配」則把專屬看守寫回這筆走查 booking(inmate_guards.booking_id)。
    const signupItem = cart.find(c => c.item_type === 'signup')
    let walkNo = null
    if (cust && signupItem && !rosterNames.includes(cust)) {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.access_token
      const resp = token ? await fetch('/api/walkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sid, name: cust, server: customerServer.trim() }),
      }).then(r => r.json()).catch(() => ({})) : {}
      if (resp.ok) {
        walkNo = resp.inmate_no
        setRosterNames(prev => [...new Set([...prev, cust])])
        if (resp.booking_id && signupItem.assign_guard_id) {
          const { error: aErr } = await supabase.from('inmate_guards').insert({ booking_id: resp.booking_id, guard_id: signupItem.assign_guard_id })
          if (aErr) setMsg('已結帳、已追加,但分配專屬獄卒失敗：' + aErr.message)
        }
      } else setMsg('已結帳,但臨時報名建號失敗：' + (resp.error || ''))
    }
    // 樂觀更新本地(不整頁刷新):新品項插到今日總表頂端、訂單備註/占用一併更新
    setItems(prev => [...(inserted ?? []), ...prev])
    setOrdersById(prev => ({ ...prev, [order.id]: { customer_name: cust || null, note: orderNote.trim() || null } }))
    setOccupied(prev => { const n = new Set(prev); for (const it of inserted ?? []) if (it.item_type === 'nominate') for (const s of arr(it.slot_times)) n.add(`${it.target_guard_id}|${s}`); return n })
    setBusy(false)
    setMsg(`已結帳 ${rows.length} 項 · ${cartTotal} 萬${walkNo != null ? ` · 臨時報名犯人編號 ${String(walkNo).padStart(4, '0')}` : ''}`)
    setCart([]); setCustomer(''); setCustomerServer(''); setOrderNote('')
    onPosChange?.()   // 通知薪資結算重算(結帳後自動更新,免手動刷新)
  }

  async function toggleStatus(it, field) {
    const val = !it[field]
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, [field]: val } : x))
    const { error } = await supabase.from('pos_order_items').update({ [field]: val }).eq('id', it.id)
    if (error) { setItems(prev => prev.map(x => x.id === it.id ? { ...x, [field]: !val } : x)); setMsg('更新失敗：' + error.message) }
  }
  async function removeItem(it) {
    setItems(prev => prev.filter(x => x.id !== it.id))   // 樂觀移除,不整頁刷新
    setConfirmDel(null)
    const { error } = await supabase.from('pos_order_items').delete().eq('id', it.id)
    if (error) { setMsg('刪除失敗：' + error.message); load() }   // 失敗才重載回滾
    else onPosChange?.()   // 通知薪資結算重算
  }

  const salesTotal = items.reduce((s, x) => s + (x.amount || 0), 0)

  // 該筆是否「已完成」:所有適用的核對項(互動/合照/拍立得)都勾了;無核對項的品項視為已完成
  const itemDone = (it) => {
    const appInteract = it.item_type === 'visit' || it.item_type === 'nominate' || (it.item_type === 'signup' && it.supervise)
    const appPhoto = it.item_type === 'visit'
    const appPolaroid = it.item_type === 'polaroid'
    if (!appInteract && !appPhoto && !appPolaroid) return true
    return (!appInteract || it.status_interact) && (!appPhoto || it.status_photo) && (!appPolaroid || it.status_polaroid)
  }
  // 今日營業總表:排序 + [只顯示未完成] 過濾
  const sortBy = (key) => { if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('asc') } }
  const sortInd = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const displayItems = useMemo(() => {
    let list = onlyUndone ? items.filter(it => !itemDone(it)) : items
    if (sortKey) {
      const val = (it) => sortKey === 'customer' ? (ordersById[it.order_id]?.customer_name || it.person_name || '')
        : sortKey === 'item' ? (ITEM_LABEL[it.item_type] ?? it.item_type)
        : sortKey === 'guard' ? (it.target_guard_id ? guardName(it.target_guard_id) : '')
        : sortKey === 'amount' ? (it.amount || 0)
        : sortKey === 'status' ? (itemDone(it) ? 1 : 0) : 0
      list = [...list].sort((a, b) => {
        const va = val(a), vb = val(b)
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'zh-Hant')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [items, onlyUndone, sortKey, sortDir, ordersById, guards])

  if (!sid) return null

  return (
    <div className="pos-unified">
      <datalist id="pos-roster">{rosterNames.map(nm => <option key={nm} value={nm} />)}</datalist>

      {/* 加購:本單犯人(指名場) + 品項 chip + 專屬細節 + 購物車 */}
      <div className="card-panel" style={{ marginBottom: 16 }}>
        <div className="head"><h2>加購</h2><span className="count">上班 {guards.length} 位</span></div>
        <div className="body">
          <div className="pos-fld" style={{ marginBottom: 12 }}><span>犯人名稱</span>
            <input className="inp" list="pos-roster" style={{ maxWidth: 320 }} value={customer} onChange={e => setCustomer(e.target.value)} placeholder="本場名單可帶入或直接打字（肖像畫可留空）" /></div>
          <div className="pos-chips">
            {chips.map(([k, dis]) => (
              <button key={k} className={`pos-chip${pick === k ? ' on' : ''}${dis ? ' dis' : ''}`} disabled={dis} onClick={() => choose(k, dis)}>
                {ITEM_LABEL[k]}{dis ? '（無可接獄卒）' : ''}
              </button>
            ))}
          </div>

          {/* [B] 細節 */}
          {!pick ? <p className="empty">選一個品項以填寫細節</p> : (
            <div className="pos-detail">
              {pick === 'signup' && (<>
                {/* 臨時報名犯人伺服器(暱稱=上方本單犯人;自動建檔發號用) */}
                <div className="pos-fld"><span>犯人伺服器</span>
                  <input className="inp" style={{ maxWidth: 200 }} value={customerServer} onChange={e => setCustomerServer(e.target.value)} placeholder="被報名犯人的伺服器" /></div>
                {/* 指名獄卒(付費指定監督) */}
                <label className="pos-chk"><input type="checkbox" checked={d.supervise} onChange={e => setD({ ...d, supervise: e.target.checked, target_guard_id: '' })} />指名監督獄卒 +10 萬</label>
                {d.supervise && (
                  <div className="pos-fld"><span>監督獄卒</span>
                    <select className="sel" value={d.target_guard_id} onChange={e => setD({ ...d, target_guard_id: e.target.value })}>
                      <option value="">— 上班獄卒 —</option>{onDuty.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select></div>
                )}
                {/* 典獄長分配專屬看守(免費;不指定則之後可於場次總覽再分配) */}
                <div className="pos-fld"><span>典獄長分配</span>
                  <select className="sel" value={d.assign_guard_id} onChange={e => setD({ ...d, assign_guard_id: e.target.value })}>
                    <option value="">不指定獄卒</option>{onDuty.map(g => <option key={g.id} value={g.id}>分配 {g.name}</option>)}
                  </select></div>
              </>)}
              {pick === 'visit' && (<>
                <div className="pos-fld"><span>探監人</span><input className="inp" value={d.visitor_name} onChange={e => setD({ ...d, visitor_name: e.target.value })} /></div>
                <div className="pos-fld"><span>執行獄卒</span>
                  <select className="sel" value={d.target_guard_id} onChange={e => setD({ ...d, target_guard_id: e.target.value })}>
                    <option value="">— 上班獄卒 —</option>{onDuty.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
                <div className="pos-fld"><span>留言</span><input className="inp" value={d.message} onChange={e => setD({ ...d, message: e.target.value })} /></div>
                <div className="pos-fld"><span>互動內容</span><input className="inp" value={d.interaction_note} onChange={e => setD({ ...d, interaction_note: e.target.value })} /></div>
              </>)}
              {pick === 'polaroid' && (<>
                <div className="pos-fld"><span>對象獄卒</span>
                  <select className="sel" value={d.target_guard_id} onChange={e => setD({ ...d, target_guard_id: e.target.value })}>
                    <option value="">— 上班獄卒 —</option>{onDuty.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
                <div className="pos-fld"><span>數量</span><input className="inp" type="number" min="1" max="99" style={{ width: 80 }} value={d.qty} onChange={e => setD({ ...d, qty: e.target.value })} /></div>
                <label className="pos-chk"><input type="checkbox" checked={d.with_signature} onChange={e => setD({ ...d, with_signature: e.target.checked })} />加購簽繪 +3 萬/張</label>
              </>)}
              {pick === 'portrait' && (<>
                <div className="pos-fld"><span>負責獄卒</span>
                  <div className="pos-cards">
                    {portraitGuards.map(g => (
                      <button key={g.id} type="button" className={`pos-gcard${d.target_guard_id === g.id ? ' on' : ''}`} onClick={() => setD({ ...d, target_guard_id: g.id })}>{g.name}</button>
                    ))}
                  </div></div>
              </>)}
              {pick === 'nominate' && (<>
                <div className="pos-fld"><span>指名獄卒</span>
                  <select className="sel" value={d.target_guard_id} onChange={e => setD({ ...d, target_guard_id: e.target.value, slot_times: [] })}>
                    <option value="">— 上班獄卒 —</option>{onDuty.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
                {d.target_guard_id && (
                  <div className="pos-fld"><span>可接時段</span>
                    <div className="pos-slots">
                      {(guards.find(g => g.id === d.target_guard_id)?.slots ?? []).map(s => {
                        const free = freeSlots(d.target_guard_id).includes(s)
                        const on = d.slot_times.includes(s)
                        return (
                          <button key={s} type="button" disabled={!free && !on} className={`m-slot ${on ? 'on' : ''} ${!free && !on ? 'taken' : ''}`}
                            onClick={() => setD({ ...d, slot_times: on ? d.slot_times.filter(x => x !== s) : [...d.slot_times, s] })}>
                            {slotLabel(session.start_time, s)}{!free && !on ? '·已占用' : ''}
                          </button>
                        )
                      })}
                    </div></div>
                )}
              </>)}
              {pick === 'entry' && <p className="muted">無額外欄位，直接加入本單(1 萬)。</p>}

              <div className="pos-detail-foot">
                <span className="pos-line-amt">小計 {cur.line ? money(cur.line.amount) : '—'}</span>
                <button className="btn-pri" disabled={!cur.line} onClick={addToCart}>加入本單</button>
              </div>
            </div>
          )}

          {/* [C] 購物車 */}
          <div className="group-lbl">本單清單 ({cart.length})<span className="ln" /></div>
          {cart.length === 0 ? <p className="empty">本單還沒有品項</p> : (<>
            {cart.map(c => (
              <div key={c._k} className="sub-row">
                <strong>{ITEM_LABEL[c.item_type]}</strong>
                {c.item_type === 'polaroid' && <span className="muted">×{c.qty}{c.with_signature ? ' 含簽繪' : ''}</span>}
                {c.item_type === 'nominate' && <span className="muted">{c.slot_times.map(s => slotLabel(session.start_time, s)).join('、')}</span>}
                {c.person_name && <span className="muted">{c.person_name}</span>}
                {c.target_guard_id && <span className="faint">{guardName(c.target_guard_id)}</span>}
                <span className="muted">{money(c.amount)}</span>
                <span className="spacer" />
                <button className="btn-sm btn-danger" onClick={() => setCart(x => x.filter(y => y._k !== c._k))}>移除</button>
              </div>
            ))}
            <div className="pos-checkout">
              <input className="inp" style={{ flex: 1, minWidth: 140 }} value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="本單備註(選填)" />
              <span className="pos-cart-total">本單小計 <b>{money(cartTotal)}</b></span>
              <button className="btn-pri" disabled={busy} onClick={checkout}>{busy ? '結帳中…' : '結帳並寫入營業額'}</button>
            </div>
          </>)}
        </div>
      </div>

      {/* [D] 今日營業總表 */}
      <div className="card-panel" style={{ marginBottom: 16 }}>
        <div className="head"><h2>今日營業總表</h2><span className="count">總銷售 {salesTotal} 萬 · {items.length} 筆</span>
          <span className="spacer" style={{ flex: 1 }} />
          <label className="pos-onlyundone"><input type="checkbox" checked={onlyUndone} onChange={e => setOnlyUndone(e.target.checked)} />只顯示未完成</label>
        </div>
        <div className="body">
          {loading ? <p className="empty">載入中…</p> : items.length === 0 ? <p className="empty">今日尚無營業紀錄</p> : (
            <table className="settle-table detail">
              <thead><tr>
                <th className="pos-sortable" onClick={() => sortBy('customer')}>本單犯人{sortInd('customer')}</th>
                <th className="pos-sortable" onClick={() => sortBy('item')}>品項{sortInd('item')}</th>
                <th>明細</th>
                <th className="pos-sortable" onClick={() => sortBy('guard')}>對象獄卒{sortInd('guard')}</th>
                <th className="pos-sortable" onClick={() => sortBy('amount')}>金額{sortInd('amount')}</th>
                <th className="pos-sortable" onClick={() => sortBy('status')}>互動{sortInd('status')}</th>
                <th>合照</th><th>拍立得</th><th>備註</th><th></th>
              </tr></thead>
              <tbody>
                {displayItems.length === 0 ? <tr><td colSpan={10} className="empty-cell" style={{ textAlign: 'center', color: 'var(--faint)', padding: '16px' }}>沒有符合條件的紀錄</td></tr>
                  : displayItems.map(it => {
                  const ord = ordersById[it.order_id] || {}
                  const customerName = ord.customer_name || it.person_name || '—'
                  const detail = it.item_type === 'polaroid' ? `×${it.qty ?? 1}${it.with_signature ? ' 含簽繪' : ''}`
                    : it.item_type === 'visit' ? `探監人 ${it.visitor_name ?? '?'} → ${it.person_name ?? '?'}`
                      : it.item_type === 'nominate' ? `${arr(it.slot_times).map(s => slotLabel(session.start_time, s)).join('、')}`
                        : '—'
                  const appInteract = it.item_type === 'visit' || it.item_type === 'nominate' || (it.item_type === 'signup' && it.supervise)
                  const appPhoto = it.item_type === 'visit'
                  const appPolaroid = it.item_type === 'polaroid'
                  const cell = (app, field) => app
                    ? <input type="checkbox" checked={!!it[field]} onChange={() => toggleStatus(it, field)} />
                    : <span className="faint">—</span>
                  return (
                    <tr key={it.id}>
                      <td className="g-name">{customerName}</td>
                      <td className="g-name">{ITEM_LABEL[it.item_type] ?? it.item_type}</td>
                      <td>{detail}</td>
                      <td>{it.target_guard_id ? guardName(it.target_guard_id) : '—'}</td>
                      <td>{money(it.amount)}</td>
                      <td>{cell(appInteract, 'status_interact')}</td>
                      <td>{cell(appPhoto, 'status_photo')}</td>
                      <td>{cell(appPolaroid, 'status_polaroid')}</td>
                      <td className="faint">{ord.note || '—'}</td>
                      <td>{confirmDel === it.id
                        ? <span style={{ display: 'inline-flex', gap: 4 }}><button className="btn-sm btn-danger" onClick={() => removeItem(it)}>確認</button><button className="btn-sm" onClick={() => setConfirmDel(null)}>取消</button></span>
                        : <button className="btn-sm btn-danger" onClick={() => setConfirmDel(it.id)}>刪</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  )
}
