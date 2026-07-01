// 場次薪資結算規則(集中管理,方便改價)。金額一律「萬」整數/半數。
// 資料來源:pos_order_items(POS 結帳寫入,已附 _customer=本單犯人)。已移除 purchase_addons 與監獄外抓捕。
// 只計算,不寫入。由 SalarySettlement.jsx 使用。
//
// 拆帳表(獄卒得=計入直接薪資的金額;監獄得靠「營業額 − 直接薪資」自動得出,不逐項計):
//   拍立得 無簽   定價 5萬   獄卒得 3.5萬
//   拍立得 簽繪   定價 8萬   獄卒得 6萬
//   指定監督(集體) 定價 10萬  獄卒得 5萬
//   指名費(指名)   定價 15萬  獄卒得 15萬(全歸,監獄得 0,靠保底成本反映)
//   互動探監      定價 5萬(試營運) 獄卒得 5萬
//   肖像畫        定價 80萬  獄卒得 80萬(當日無底薪)
//
// 計算順序:
//   直接薪資 = 底薪 + 個人服務獎金(獄卒得),不含均分獎金。
//   集體趕稿:淨收入 = 營業額 − 直接薪資總額;均分獎金池 = 淨收入×0.5(上班獄卒均分);監獄留存 = 淨收入×0.5;
//            每位最終薪資 = 直接薪資 + 均分獎金。
//   指名互動:無均分。服務收入 = 指名費 + 拍立得獄卒得;薪資 = max(底薪10, 服務收入);監獄結餘 = 營業額 − 薪資總額(可負)。

export const RATES = {
  base: 10,               // 底薪
  polaroidUnsigned: 3.5,  // 無簽拍立得 獄卒得/張
  polaroidSigned: 6,      // 簽繪拍立得 獄卒得/張
  supervise: 5,           // 指定監督 獄卒得/次
  visit: 5,               // 互動探監 獄卒得/次
  portrait: 80,           // 肖像畫 獄卒得/張(無底薪)
  namedSlot: 15,          // 指名 獄卒得/30 分時段
  poolRate: 0.5,          // 集體場淨收入 → 獎金池 / 監獄留存 各半
}

// 監獄營業額逐項用的「定價」(僅供監獄收支卡分組加總;個別 pos_order_items.amount 已含這些定價)
const PRICE = { entry: 20, supervise: 10 }   // 集體:入場費 20、指定監督 +10

const arr = v => Array.isArray(v) ? v : []
export const w = n => String(Math.round((Number(n) || 0) * 100) / 100)
export const money = n => `${w(n)} 萬`

// 拍立得明細列:依「本單犯人」分組,回傳 { name, tag, calc, amount }
function polaroidRows(items, signed) {
  const unit = signed ? RATES.polaroidSigned : RATES.polaroidUnsigned
  const groups = {}
  for (const r of items) {
    const key = r._customer || r.person_name || '（未指定）'
    groups[key] = (groups[key] || 0) + (r.qty || 0)
  }
  return Object.entries(groups).map(([name, qty]) => ({
    name, tag: signed ? '簽繪' : '空白', calc: `${w(unit)}萬 × ${qty}張`, amount: unit * qty,
  }))
}

// 依人名彙總次數(指定監督),回傳 { name, calc, amount }
function countRows(items, unit) {
  const groups = {}
  for (const r of items) { const key = r._customer || r.person_name || '（未指定）'; groups[key] = (groups[key] || 0) + 1 }
  return Object.entries(groups).map(([name, qty]) => ({
    name, calc: `${w(unit)}萬 × ${qty}`, amount: unit * qty,
  }))
}

export function calcSettlement({ kind, guards, items }) {
  const byGuard = {}
  for (const it of items) { const g = it.target_guard_id; if (!g) continue; (byGuard[g] ??= []).push(it) }
  const revenue = items.reduce((s, it) => s + (it.amount || 0), 0)

  const perGuard = guards.map(g => {
    const its = byGuard[g.id] ?? []
    const segments = []   // { title, amount, note?, rows?:[{name,tag?,calc?,amount}] }

    const pol = its.filter(x => x.item_type === 'polaroid')
    const polU = pol.filter(x => !x.with_signature), polS = pol.filter(x => x.with_signature)
    const qtyU = polU.reduce((s, x) => s + (x.qty || 0), 0), qtyS = polS.reduce((s, x) => s + (x.qty || 0), 0)
    const polUAmt = RATES.polaroidUnsigned * qtyU, polSAmt = RATES.polaroidSigned * qtyS
    const portraits = its.filter(x => x.item_type === 'portrait')
    const supervises = its.filter(x => x.item_type === 'signup' && x.supervise)
    const visits = its.filter(x => x.item_type === 'visit')
    const noms = its.filter(x => x.item_type === 'nominate')
    const slots = noms.reduce((s, x) => s + arr(x.slot_times).length, 0)

    let direct                                  // 三分支(肖像/指名/集體)必其一賦值

    if (portraits.length > 0) {                 // 肖像畫獄卒:全收,當日無底薪
      const amt = RATES.portrait * portraits.length
      segments.push({ title: '肖像畫', amount: amt, rows: portraits.map(p => ({ name: p._customer || p.person_name || '（未指定）', amount: RATES.portrait })) })
      direct = amt
    } else if (kind === 'named') {              // 指名互動:max(底薪, 服務收入)
      let service = 0
      if (slots) { const a = RATES.namedSlot * slots; segments.push({ title: '指名時段', amount: a, rows: noms.map(x => ({ name: x._customer || '（未指定）', calc: `${w(RATES.namedSlot)}萬 × ${arr(x.slot_times).length}段`, amount: RATES.namedSlot * arr(x.slot_times).length })) }); service += a }
      if (qtyU) { segments.push({ title: '拍立得（空白）', amount: polUAmt, rows: polaroidRows(polU, false) }); service += polUAmt }
      if (qtyS) { segments.push({ title: '拍立得（簽繪）', amount: polSAmt, rows: polaroidRows(polS, true) }); service += polSAmt }
      const floor = Math.max(0, RATES.base - service)
      if (floor > 0) segments.push({ title: '底薪補足', amount: floor })
      direct = service + floor
    } else {                                    // 集體趕稿:底薪 + 個人服務獎金
      segments.push({ title: '底薪', amount: RATES.base })
      direct = RATES.base
      if (qtyU) { segments.push({ title: '拍立得（空白）', amount: polUAmt, rows: polaroidRows(polU, false) }); direct += polUAmt }
      if (qtyS) { segments.push({ title: '拍立得（簽繪）', amount: polSAmt, rows: polaroidRows(polS, true) }); direct += polSAmt }
      if (supervises.length) { const a = RATES.supervise * supervises.length; segments.push({ title: '指定監督', amount: a, rows: countRows(supervises, RATES.supervise) }); direct += a }
      if (visits.length) { const a = RATES.visit * visits.length; segments.push({ title: '互動探監', amount: a, rows: visits.map(x => ({ name: `${x.visitor_name || '?'} → ${x.person_name || '?'}`, amount: RATES.visit })) }); direct += a }
    }
    return { id: g.id, name: g.name, direct, pool: 0, final: direct, segments }
  })

  const directTotal = perGuard.reduce((s, g) => s + g.direct, 0)

  // 監獄營業額逐項(依定價分組加總)
  const nSignup = items.filter(x => x.item_type === 'signup').length
  const nSupervise = items.filter(x => x.item_type === 'signup' && x.supervise).length
  const sumType = t => items.filter(x => x.item_type === t).reduce((s, x) => s + (x.amount || 0), 0)
  const revenueRows = []
  if (kind === 'crunch') {
    if (nSignup) revenueRows.push({ label: '入場費', amount: PRICE.entry * nSignup })
    if (nSupervise) revenueRows.push({ label: '指定監督', amount: PRICE.supervise * nSupervise })
    const v = sumType('visit'); if (v) revenueRows.push({ label: '互動探監', amount: v })
    const p = sumType('polaroid'); if (p) revenueRows.push({ label: '拍立得', amount: p })
    const po = sumType('portrait'); if (po) revenueRows.push({ label: '肖像畫', amount: po })
  } else {
    const nom = sumType('nominate'); if (nom) revenueRows.push({ label: '指名費', amount: nom })
    const e = sumType('entry'); if (e) revenueRows.push({ label: '無指名入場', amount: e })
    const p = sumType('polaroid'); if (p) revenueRows.push({ label: '拍立得', amount: p })
    const po = sumType('portrait'); if (po) revenueRows.push({ label: '肖像畫', amount: po })
  }

  // 集體趕稿 / 指名互動 皆有均分獎金:淨收入 50% 均分給出勤獄卒、50% 監獄留存
  const net = revenue - directTotal
  const pool = net > 0 ? net * RATES.poolRate : 0   // 淨收為負時不發獎金(獎金 0,不倒扣獄卒);監獄留存吸收負值
  const perPool = guards.length ? pool / guards.length : 0
  const retain = net - pool
  perGuard.forEach(g => {
    g.pool = perPool; g.final = g.direct + perPool
    if (perPool) g.segments.push({ title: '均分獎金', note: `淨收 50% ÷ ${guards.length} 人`, amount: perPool })
  })
  const salaryTotal = perGuard.reduce((s, g) => s + g.final, 0)
  return { kind, revenue, directTotal, net, pool, perPool, retain, salaryTotal, revenueRows, guards: perGuard }
}
