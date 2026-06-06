// 稿件完成度的「唯一一條」計算邏輯,全系統共用,避免兩套並存。
//
// 規則:
//   有子項目 → 完成度 = 已完成子項目 / 子項目總數(沿用原算法)。
//   無子項目 → 由稿件層級的 is_done 直接決定:勾=100%、未勾=0%。
//
// 可傳入原始 steps 陣列,或已聚合的 done/total(名單總覽用聚合值)。
// 回傳:{ done, total, pct(0~1), hasSteps, complete }
export function computeProgress({ steps, done, total, isDone = false } = {}) {
  const t = steps ? steps.length : (total ?? 0)
  const d = steps ? steps.filter(s => s.done).length : (done ?? 0)
  if (t > 0) {
    return { done: d, total: t, pct: d / t, hasSteps: true, complete: d === t }
  }
  // 無子項目:走稿件層級直接勾選
  return { done: isDone ? 1 : 0, total: 0, pct: isDone ? 1 : 0, hasSteps: false, complete: !!isDone }
}
