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

// 同囚 / 犯人列狀態 chip 文字:只依「本場目標完成度」,完全脫離番茄鐘。
//   doneGoals / totalGoals 皆為「目標(稿件)」層級的計數,每個目標是否完成請用 computeProgress 判定。
//   邊界:沒挑任何目標(totalGoals=0)→「尚未挑稿」(沒有目標 ≠ 完成);
//         有目標且全部完成 →「服刑完畢」;有目標但未全完成 →「服刑中」。
export function goalStatusLabel(doneGoals, totalGoals) {
  if (!totalGoals) return '尚未挑稿'
  return doneGoals >= totalGoals ? '服刑完畢' : '服刑中'
}
