import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'

// 「指派專屬獄卒」共用元件:給定某位本場犯人的 session_inmate id 與本場獄卒清單(guardRoster),
// 自管 inmate_guards 的讀取 / 指派 / 移除。供 SessionTab(進行中場次)與 SessionsOverviewTab(場次總覽展開)共用,
// 避免兩處重複維護指派邏輯。沿用既有分開查再 JS 合併的風格,不用巢狀 select。
//   props:
//     sessionInmateId — 犯人在本場的 session_inmates id
//     guardRoster     — 本場獄卒清單 [{ id, member_id, profile }](用來提供可指派選項與解析暱稱)
//     setMsg          — 錯誤/提示訊息回拋
export default function GuardAssign({ sessionInmateId, guardRoster, setMsg }) {
  const [assigned, setAssigned] = useState([])   // [{ id, guard_id, profile }]
  const [pick, setPick] = useState('')           // 下拉選中要指派的 guard member_id

  async function load() {
    const { data: igs } = await supabase.from('inmate_guards')
      .select('id, guard_id').eq('session_inmate_id', sessionInmateId)
    if (!igs || !igs.length) { setAssigned([]); return }
    // 獄卒 profile:優先用本場獄卒清單解析;讀不到的(可能已移出本場)再補查 profiles
    const byId = {}; for (const g of guardRoster ?? []) if (g.profile) byId[g.member_id] = g.profile
    const missing = igs.map(g => g.guard_id).filter(id => !byId[id])
    if (missing.length) {
      const { data: profs } = await supabase.from('profiles')
        .select('id, game_name, display_name, avatar_url, role').in('id', missing)
      for (const p of profs ?? []) byId[p.id] = p
    }
    setAssigned(igs.map(g => ({ id: g.id, guard_id: g.guard_id, profile: byId[g.guard_id] })))
  }
  useEffect(() => { load() }, [sessionInmateId])

  async function assignGuard() {
    if (!pick) return
    const { error } = await supabase.from('inmate_guards')
      .insert({ session_inmate_id: sessionInmateId, guard_id: pick })
    if (error) { setMsg?.('指派失敗：' + error.message); return }
    setPick(''); load()
  }

  async function removeAssign(inmateGuardId) {
    const { error } = await supabase.from('inmate_guards').delete().eq('id', inmateGuardId)
    if (error) { setMsg?.('移除指派失敗：' + error.message); return }
    load()
  }

  const options = (guardRoster ?? []).filter(g => !assigned.some(a => a.guard_id === g.member_id))

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {assigned.length === 0
          ? <span className="v">未指派</span>
          : assigned.map(a => (
            <span key={a.id} className="tag tag-pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(63,179,107,.12)', color: 'var(--ok)' }}>
              {a.profile?.role === 'warden' ? '典獄長' : '獄卒'}·{a.profile?.game_name ?? a.profile?.display_name ?? '?'}
              <button onClick={() => removeAssign(a.id)} style={{ border: 'none', background: 'none', color: 'inherit', padding: 0, minHeight: 'auto' }}>✕</button>
            </span>
          ))}
      </div>
      <div className="detail-row">
        <select className="sel" value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">— 指派專屬獄卒 —</option>
          {options.map(g => <option key={g.id} value={g.member_id}>{g.profile?.game_name ?? g.profile?.display_name}</option>)}
        </select>
        <button className="btn-sm" onClick={assignGuard}>指派</button>
        {(guardRoster ?? []).length === 0 && <span className="faint">（本場尚無獄卒可指派）</span>}
      </div>
    </div>
  )
}
