import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { slotLabel } from '../slots'

// 指名現場(僅指名場、進行中場次分頁用):列出本場預約,現場核對「到場 + 購買品項」。
// 指名場不走番茄鐘,改由典獄長在此逐筆確認/加購。
// 品項:指名(item_named)、拍立得(item_polaroid)、拍立得簽繪(item_polaroid_sign,依附拍立得)。
// 更新走 bookings 直改(RLS:is_warden() 可改),樂觀更新 + 失敗回滾。
export default function NamedSessionDesk({ sessionId, startTime, setMsg }) {
  const [rows, setRows] = useState([])            // 本場預約(未取消)
  const [guardNames, setGuardNames] = useState({}) // guard_id -> 顯示名
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!sessionId) return
    setLoading(true)
    const { data: bk } = await supabase.from('bookings')
      .select('id, user_id, dc_name, game_name, requested_guard_id, requested_slot, arrived, item_named, item_polaroid, item_polaroid_sign, created_at')
      .eq('session_id', sessionId).neq('status', 'cancelled').order('created_at')
    const list = bk ?? []
    // 指名獄卒 id → 顯示名(分開查 profiles 再 JS 合併)
    const gids = [...new Set(list.map(b => b.requested_guard_id).filter(Boolean))]
    if (gids.length) {
      const { data: gp } = await supabase.from('profiles').select('id, game_name, display_name').in('id', gids)
      const gm = {}; for (const p of gp ?? []) gm[p.id] = p.game_name || p.display_name || '獄卒'
      setGuardNames(gm)
    } else setGuardNames({})
    setRows(list); setLoading(false)
  }
  useEffect(() => { load() }, [sessionId])

  // 樂觀更新單筆 booking 的旗標;失敗回滾並提示。
  async function patchRow(b, patch, okMsg) {
    const snapshot = rows
    setRows(prev => prev.map(x => x.id === b.id ? { ...x, ...patch } : x))
    const { error } = await supabase.from('bookings').update(patch).eq('id', b.id)
    if (error) { setRows(snapshot); setMsg('更新失敗，已還原：' + error.message); return }
    if (okMsg) setMsg(okMsg)
  }

  const toggleArrived = b => patchRow(b, { arrived: !b.arrived }, b.arrived ? '已取消到場' : '已標記到場')
  const toggleNamed = b => patchRow(b, { item_named: !b.item_named }, b.item_named ? '已取消指名' : '已確認指名')
  // 拍立得:關閉時連帶關閉簽繪(DB check 兜底,前端一併處理避免違反約束)
  const togglePolaroid = b => patchRow(b,
    b.item_polaroid ? { item_polaroid: false, item_polaroid_sign: false } : { item_polaroid: true },
    b.item_polaroid ? '已取消拍立得' : '已確認/加購拍立得')
  // 簽繪:開啟時一併確保拍立得為真
  const toggleSign = b => patchRow(b,
    b.item_polaroid_sign ? { item_polaroid_sign: false } : { item_polaroid: true, item_polaroid_sign: true },
    b.item_polaroid_sign ? '已取消簽繪' : '已確認/加購簽繪')

  const nameOf = b => b.game_name || b.dc_name || '（未填暱稱）'

  return (
    <div className="card-panel visit-panel">
      <div className="head">
        <h2>指名現場</h2>
        <span className="count">{rows.length} 筆 · 到場 {rows.filter(r => r.arrived).length}</span>
      </div>
      <div className="body">
        {loading ? <p className="empty">載入中…</p>
          : rows.length === 0 ? <p className="empty">本場還沒有預約</p>
            : (
              <div className="visit-list">
                {rows.map(b => {
                  const gname = b.requested_guard_id ? (guardNames[b.requested_guard_id] ?? '獄卒') : null
                  const slot = b.requested_slot != null ? slotLabel(startTime, b.requested_slot) : null
                  return (
                    <div key={b.id} className={`visit-row${b.arrived ? '' : ' done'}`}>
                      <div className="visit-text">
                        <span className="visit-who">
                          {b.arrived ? '✅' : '⬜'} {nameOf(b)}
                          {!b.user_id && <span className="tag tag-pill" style={{ background: 'rgba(255,255,255,.12)', color: 'var(--dim, #aaa)', marginLeft: 6 }}>訪客</span>}
                        </span>
                        <span className="visit-body">
                          {gname
                            ? <>指名：{gname}{slot ? `（${slot}）` : ''}</>
                            : <span className="faint">不指定（由典獄長安排）</span>}
                        </span>
                      </div>
                      <span className="spacer" />
                      <div className="visit-acts">
                        <button className={`btn-sm${b.arrived ? ' btn-pri' : ''}`} onClick={() => toggleArrived(b)}>
                          {b.arrived ? '✓ 已到場' : '標記到場'}
                        </button>
                        <button className={`btn-sm${b.item_named ? ' btn-pri' : ''}`} onClick={() => toggleNamed(b)}>
                          {b.item_named ? '✓ 指名' : '指名'}
                        </button>
                        <button className={`btn-sm${b.item_polaroid ? ' btn-pri' : ''}`} onClick={() => togglePolaroid(b)}>
                          {b.item_polaroid ? '✓ 拍立得' : '＋拍立得'}
                        </button>
                        <button className={`btn-sm${b.item_polaroid_sign ? ' btn-pri' : ''}`} onClick={() => toggleSign(b)}>
                          {b.item_polaroid_sign ? '✓ 簽繪' : '＋簽繪'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
      </div>
    </div>
  )
}
