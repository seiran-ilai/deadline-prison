import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { slotLabel } from '../slots'

// 指名互動場的獄卒排班:設「當日上班」獄卒,並逐位挑哪幾個半小時時格可被指名(可指名 ⊆ 上班)。
// 寫入 session_guards(slots = 可指名時格 index 陣列;RLS 限典獄長)。供 SessionsOverviewTab 展開面板使用。
//   props:
//     sessionId — 本場 id
//     staff     — 全體獄方 profiles [{ id, game_name, display_name, avatar_url, role }]
//     slotCount — 本場時格數(每段 30 分)
//     startTime — 本場開始時間('HH:MM'/'HH:MM:SS' 或 null;null → 時格標「第 N 節」)
//     setMsg    — 錯誤/提示回拋
export default function SessionGuardPlan({ sessionId, staff, slotCount, startTime, setMsg }) {
  const [rows, setRows] = useState({})   // guard_id -> { id, slots:number[] }
  const [loading, setLoading] = useState(true)

  const n = slotCount > 0 ? slotCount : 4
  const slotIdxs = Array.from({ length: n }, (_, i) => i)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('session_guards')
      .select('id, guard_id, slots').eq('session_id', sessionId)
    if (error) { setMsg?.('讀取獄卒排班失敗：' + error.message); setLoading(false); return }
    const m = {}; for (const r of data ?? []) m[r.guard_id] = { id: r.id, slots: r.slots ?? [] }
    setRows(m); setLoading(false)
  }
  useEffect(() => { load() }, [sessionId])

  // 上班開關:勾 → insert(slots 空);取消 → delete(可指名時格一併清掉)
  async function toggleOnDuty(guardId, on) {
    if (on) {
      const { data, error } = await supabase.from('session_guards')
        .insert({ session_id: sessionId, guard_id: guardId }).select('id, slots').single()
      if (error) { setMsg?.('加入上班失敗：' + error.message); return }
      setRows(prev => ({ ...prev, [guardId]: { id: data.id, slots: data.slots ?? [] } }))
    } else {
      const { error } = await supabase.from('session_guards')
        .delete().eq('session_id', sessionId).eq('guard_id', guardId)
      if (error) { setMsg?.('移除失敗：' + error.message); return }
      setRows(prev => { const x = { ...prev }; delete x[guardId]; return x })
    }
  }

  // 時格可指名開關(僅上班者可切):把 index 加入/移出 slots 陣列
  async function toggleSlot(guardId, idx) {
    const row = rows[guardId]; if (!row) return
    const has = row.slots.includes(idx)
    const next = has ? row.slots.filter(i => i !== idx) : [...row.slots, idx].sort((a, b) => a - b)
    setRows(prev => ({ ...prev, [guardId]: { ...prev[guardId], slots: next } }))   // 樂觀
    const { error } = await supabase.from('session_guards').update({ slots: next }).eq('id', row.id)
    if (error) {
      setRows(prev => ({ ...prev, [guardId]: { ...prev[guardId], slots: row.slots } }))
      setMsg?.('更新時格失敗：' + error.message)
    }
  }

  if (loading) return <p className="empty">讀取獄卒排班中…</p>
  if (!staff.length) return <p className="empty">名單中沒有獄方人員可排班</p>

  const onDutyCount = Object.keys(rows).length
  const nameableCount = Object.values(rows).filter(r => r.slots.length).length

  return (
    <div className="guard-plan">
      <div className="group-lbl">獄卒排班 · 上班 {onDutyCount}／可指名 {nameableCount}<span className="ln" /></div>
      <p className="faint" style={{ margin: '0 0 8px' }}>勾「上班」選當日在場獄卒;再點下方時格開放被指名(每格半小時、一名客人)。</p>
      {staff.map(g => {
        const row = rows[g.id]
        const onDuty = !!row
        const name = g.game_name || g.display_name || '（未命名）'
        return (
          <div key={g.id} className="gp-row">
            <label className="gp-onduty">
              <input type="checkbox" checked={onDuty} onChange={e => toggleOnDuty(g.id, e.target.checked)} />
              <span className="gp-name">{g.role === 'warden' ? '典獄長·' : ''}{name}</span>
            </label>
            <div className="gp-slots" style={{ opacity: onDuty ? 1 : 0.35 }}>
              {slotIdxs.map(i => {
                const on = !!row?.slots.includes(i)
                return (
                  <button key={i} type="button" className={`gp-slot ${on ? 'on' : ''}`}
                    disabled={!onDuty} onClick={() => toggleSlot(g.id, i)}>
                    {slotLabel(startTime, i)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
