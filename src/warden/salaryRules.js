// 場次薪資結算規則(集中管理,方便日後改價)。金額一律以「萬」為單位。
// 只計算,不寫入。由 SalarySettlement.jsx 使用。

export const RATES = {
  base: 10,              // 底薪
  polaroidUnsigned: 3.5, // 無簽繪拍立得(獄卒抽成)
  polaroidSigned: 6,     // 簽繪拍立得(獄卒抽成)
  supervise: 5,          // 被指定監督(集體場)
  visit: 5,              // 互動探監執行(集體場)
  captureBonus: 5,       // 抓捕參與個人獎金
  capturePrice: 15,      // 抓捕定價/人(其中監獄 10、本人 5)
  portrait: 80,          // 肖像畫/張(無底薪)
  namedSlot: 15,         // 指名 /30 分時段
  poolRate: 0.5,         // 集體場共享獎金池比例
}

// 金額格式:最多兩位小數,去尾零。
export const w = n => String(Math.round((Number(n) || 0) * 100) / 100)
export const money = n => `${w(n)} 萬`

function countAddon(addons, type, gid, signed) {
  return addons.filter(a => a.addon_type === type && a.target_guard_id === gid
    && (signed === undefined || !!a.with_signature === signed)).length
}

// 結算核心(純函式,集中所有規則)。回傳整場總覽 + 每位獄卒明細(lines 為逐項獎金)。
export function calcSettlement({ kind, guards, addons, slotsByGuard, captureSet }) {
  const captureCount = guards.filter(g => captureSet.has(g.id)).length
  // 當日營業額 = 各項定價總額。purchase_addons.amount 即各項定價(萬);
  // 抓捕改由介面計(15 × 參與人數),故排除 addon 內的 capture 列避免重複計。
  const addonRevenue = addons.filter(a => a.addon_type !== 'capture')
    .reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const revenue = addonRevenue + RATES.capturePrice * captureCount

  const perGuard = guards.map(g => {
    const portrait = countAddon(addons, 'portrait', g.id)
    const unsigned = countAddon(addons, 'polaroid', g.id, false)
    const signed = countAddon(addons, 'polaroid', g.id, true)
    const supervise = countAddon(addons, 'supervise', g.id)
    const visit = countAddon(addons, 'visit', g.id)
    const captured = captureSet.has(g.id) ? 1 : 0
    const slots = slotsByGuard[g.id] || 0
    const lines = []
    let direct

    if (kind === 'named') {
      // 指名互動場:收入全歸該獄卒,無 50% 均分。
      if (portrait > 0) {
        direct = RATES.portrait * portrait
        lines.push({ label: '肖像畫', detail: `80 × ${portrait}`, amount: direct })
      } else {
        const service = RATES.namedSlot * slots + RATES.polaroidUnsigned * unsigned + RATES.polaroidSigned * signed
        lines.push({ label: '指名時段', detail: `15 × ${slots}`, amount: RATES.namedSlot * slots })
        if (unsigned) lines.push({ label: '拍立得(無簽繪)', detail: `3.5 × ${unsigned}`, amount: RATES.polaroidUnsigned * unsigned })
        if (signed) lines.push({ label: '拍立得(簽繪)', detail: `6 × ${signed}`, amount: RATES.polaroidSigned * signed })
        direct = Math.max(RATES.base, service)   // 低於底薪補足,超過不補
        if (service < RATES.base) lines.push({ label: '底薪補足', detail: `補至 ${RATES.base}`, amount: RATES.base - service })
      }
    } else {
      // 集體趕稿場:底薪 + 各項服務獎金;之後再加均分。
      if (portrait > 0) {
        direct = RATES.portrait * portrait
        lines.push({ label: '肖像畫', detail: `80 × ${portrait}`, amount: direct })
      } else {
        direct = RATES.base
        lines.push({ label: '底薪', detail: '10', amount: RATES.base })
        if (unsigned) { direct += RATES.polaroidUnsigned * unsigned; lines.push({ label: '拍立得(無簽繪)', detail: `3.5 × ${unsigned}`, amount: RATES.polaroidUnsigned * unsigned }) }
        if (signed) { direct += RATES.polaroidSigned * signed; lines.push({ label: '拍立得(簽繪)', detail: `6 × ${signed}`, amount: RATES.polaroidSigned * signed }) }
        if (supervise) { direct += RATES.supervise * supervise; lines.push({ label: '指定監督', detail: `5 × ${supervise}`, amount: RATES.supervise * supervise }) }
        if (visit) { direct += RATES.visit * visit; lines.push({ label: '互動探監', detail: `5 × ${visit}`, amount: RATES.visit * visit }) }
        if (captured) { direct += RATES.captureBonus * captured; lines.push({ label: '抓捕參與', detail: `5 × ${captured}`, amount: RATES.captureBonus * captured }) }
      }
    }
    return { id: g.id, name: g.name, portrait, unsigned, signed, supervise, visit, captured, slots, lines, direct, pool: 0, final: direct }
  })

  const salaryTotal = perGuard.reduce((s, g) => s + g.direct, 0)

  if (kind === 'named') {
    const balance = revenue - salaryTotal   // 監獄結餘(可能為負:補底薪成本)
    return { kind, revenue, salaryTotal, balance, guards: perGuard }
  }
  // 集體趕稿場:監獄毛收入 → 50% 均分池 + 50% 留存。
  const gross = revenue - salaryTotal
  const pool = gross * RATES.poolRate
  const perPool = guards.length ? pool / guards.length : 0
  const retain = gross * RATES.poolRate
  perGuard.forEach(g => { g.pool = perPool; g.final = g.direct + perPool })
  return { kind, revenue, salaryTotal, gross, pool, perPool, retain, guards: perGuard }
}
