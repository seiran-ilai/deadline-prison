import { supabase } from './supabaseClient'

// 品項價目單一真相:DB 端 price_items(定價/優惠價/獄卒得,依場次類型分類)。
// 尚未跑遷移 / 讀取失敗時退回 DEFAULT_PRICES(對齊現行價格與拆帳),前端不會壞。
// 有優惠價(sale_price != null)時:官網顯示定價劃線+優惠價;POS 結帳可選優惠價或定價。
// guard_cut = 獄卒得/每單位(薪資結算讀此欄;null = 不參與拆帳);監獄得 = 實收 − 獄卒得。
// 優惠結帳不影響薪資結算:獄卒仍照 guard_cut 拿,優惠差額由監獄吸收。金額單位一律「萬」。

export const DEFAULT_PRICES = [
  { kind: 'crunch', item_key: 'signup',      name: '入場費',         unit: '萬',          list_price: 20, sale_price: null, guard_cut: 0,    sort_order: 1 },
  { kind: 'crunch', item_key: 'supervise',   name: '指定監督獄卒',   unit: '萬',          list_price: 10, sale_price: null, guard_cut: 5,    sort_order: 2 },
  { kind: 'crunch', item_key: 'visit',       name: '互動探監',       unit: '萬',          list_price: 10, sale_price: 5,    guard_cut: 5,    sort_order: 3 },
  { kind: 'crunch', item_key: 'polaroid',    name: '拍立得（空白）', unit: '萬／張',      list_price: 5,  sale_price: null, guard_cut: 3.5,  sort_order: 4 },
  { kind: 'crunch', item_key: 'sign',        name: '拍立得加購簽繪', unit: '萬／張',      list_price: 3,  sale_price: null, guard_cut: 2.5,  sort_order: 5 },
  { kind: 'crunch', item_key: 'capture',     name: '監獄外抓捕',     unit: '萬起',        list_price: 30, sale_price: null, guard_cut: null, sort_order: 6 },
  { kind: 'crunch', item_key: 'capture_add', name: '抓捕加派獄卒',   unit: '萬／位',      list_price: 15, sale_price: null, guard_cut: null, sort_order: 7 },
  { kind: 'crunch', item_key: 'portrait',    name: '肖像畫',         unit: '萬',          list_price: 80, sale_price: null, guard_cut: 80,   sort_order: 8 },
  { kind: 'named',  item_key: 'nominate',    name: '指名費',         unit: '萬／30 分鐘', list_price: 15, sale_price: null, guard_cut: 15,   sort_order: 1 },
  { kind: 'named',  item_key: 'entry',       name: '無指名入場',     unit: '萬',          list_price: 1,  sale_price: null, guard_cut: 0,    sort_order: 2 },
  { kind: 'named',  item_key: 'polaroid',    name: '拍立得（空白）', unit: '萬／張',      list_price: 5,  sale_price: null, guard_cut: 3.5,  sort_order: 3 },
  { kind: 'named',  item_key: 'sign',        name: '拍立得加購簽繪', unit: '萬／張',      list_price: 3,  sale_price: null, guard_cut: 2.5,  sort_order: 4 },
  { kind: 'named',  item_key: 'portrait',    name: '肖像畫',         unit: '萬',          list_price: 80, sale_price: null, guard_cut: 80,   sort_order: 5 },
]

const num = (v) => (v == null || v === '' ? null : Number(v))

// 讀取價目表;失敗或空表退回預設(id 為 undefined 代表尚未入庫)
export async function fetchPriceRows() {
  const { data, error } = await supabase.from('price_items')
    .select('id, kind, item_key, name, unit, list_price, sale_price, guard_cut, sort_order')
    .order('kind').order('sort_order')
  if (error || !data || data.length === 0) return DEFAULT_PRICES.map(r => ({ ...r }))
  return data.map(r => ({ ...r, list_price: num(r.list_price) ?? 0, sale_price: num(r.sale_price), guard_cut: num(r.guard_cut) }))
}

// rows → { 'kind|item_key': row } 查價表
export function priceMap(rows) {
  const m = {}
  for (const r of rows ?? []) m[`${r.kind}|${r.item_key}`] = r
  return m
}

// 生效價:有優惠價用優惠價,否則定價。useList=true 一律用定價。
export function effPrice(row, useList = false) {
  if (!row) return 0
  if (useList) return row.list_price ?? 0
  return row.sale_price ?? row.list_price ?? 0
}

// 該品項是否有優惠價(結帳時才需要出現「優惠價/定價」選擇)
export const hasSale = (row) => row != null && row.sale_price != null && row.sale_price !== row.list_price

// 由價目表組出薪資結算用的拆帳率(對應 salaryRules.RATES 的品項鍵;值為 null 的鍵會落回內建預設)。
// 簽繪拍立得獄卒得 = 拍立得(空白)獄卒得 + 簽繪加購獄卒得。優惠結帳不影響拆帳(以單位數計,不看實收)。
export function settlementRates(rows, kind) {
  const pm = priceMap(rows)
  const gc = (key) => {
    const r = pm[`${kind}|${key}`]
    return r && r.guard_cut != null ? Number(r.guard_cut) : null
  }
  const pol = gc('polaroid'), sgn = gc('sign')
  return {
    polaroidUnsigned: pol,
    polaroidSigned: pol != null || sgn != null ? (pol ?? 0) + (sgn ?? 0) : null,
    supervise: gc('supervise'),
    visit: gc('visit'),
    portrait: gc('portrait'),
    namedSlot: gc('nominate'),
  }
}
