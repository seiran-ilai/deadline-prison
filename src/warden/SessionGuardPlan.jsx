import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { slotLabel } from '../slots'

// 獄卒排班(卡片選擇):點卡片切換「當日上班」。named 場的上班卡片再點下方時格開放被指名(每格半小時、一名客人);
// crunch 場只需選上班(供被指定監督)。「可加購拍立得」改為獄卒全域設定(名單總覽>獄卒名單),此處不再設定。
// 寫入 session_guards(slots = 可指名時格 index 陣列;RLS 限典獄長)。
//   props:sessionId / staff(全體獄方 profiles)/ slotCount / startTime / setMsg / kind
export default function SessionGuardPlan({ sessionId, staff, slotCount, startTime, setMsg, kind = 'named' }) {
  const [rows, setRows] = useState({})   // guard_id -> { id, slots:number[] }
  const [loading, setLoading] = useState(true)
  const isNamed = kind === 'named'

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
      <div className="group-lbl">獄卒排班 · 上班 {onDutyCount}{isNamed ? `／可指名 ${nameableCount}` : ''}<span className="ln" /></div>
      <p className="faint" style={{ margin: '0 0 10px' }}>
        {isNamed
          ? '點卡片選當日上班獄卒；上班後再點卡片內時格開放被指名（每格半小時、一名客人）。'
          : '點卡片選當日上班獄卒（集體場可被指定監督）。'}
      </p>
      <div className="gp-cards">
        {staff.map(g => {
          const row = rows[g.id]
          const onDuty = !!row
          const name = g.game_name || g.display_name || '（未命名）'
          return (
            <div key={g.id} className={`gp-card${onDuty ? ' on' : ''}`}>
              <button type="button" className="gp-card-head" onClick={() => toggleOnDuty(g.id, !onDuty)}>
                <span className="gp-card-av">
                  {g.avatar_url ? <img src={g.avatar_url} alt="" /> : (name[0] || '?')}
                </span>
                <span className="gp-card-nm">{g.role === 'warden' ? '典獄長·' : ''}{name}{g.portrait_only ? '（肖像）' : ''}</span>
                <span className={`gp-card-flag${onDuty ? ' on' : ''}`}>{onDuty ? '✓ 上班' : '休假'}</span>
              </button>
              {isNamed && onDuty && !g.portrait_only && (
                <div className="gp-card-slots">
                  {slotIdxs.map(i => {
                    const on = !!row?.slots.includes(i)
                    return (
                      <button key={i} type="button" className={`gp-slot ${on ? 'on' : ''}`} onClick={() => toggleSlot(g.id, i)}>
                        {slotLabel(startTime, i)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
