import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { slotLabel } from '../slots'

// 指名現場(僅指名/集體場、進行中場次分頁用):現場核對「到場」+ 檢視本場預約的指名/監督、每卒加購、抓捕訂單。
// 指名/集體場不走番茄鐘,改由典獄長在此逐筆確認到場。資料改讀 bookings 的 jsonb:
//   requested_slots [{g,s}]  s!=null 為指名時格、s=null 為集體場指定監督
//   addons          [{g,polaroid,sign}]  每卒加購數量
//   capture         { client,target,server } | null  集體場「把朋友抓進去」訂單
// 更新走 bookings 直改(RLS:is_warden() 可改),樂觀更新 + 失敗回滾。
export default function NamedSessionDesk({ sessionId, startTime, setMsg }) {
  const [rows, setRows] = useState([])            // 本場預約(未取消)
  const [guardNames, setGuardNames] = useState({}) // guard_id -> 顯示名
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!sessionId) return
    setLoading(true)
    const { data: bk } = await supabase.from('bookings')
      .select('id, user_id, dc_name, game_name, requested_slots, addons, capture, arrived, created_at')
      .eq('session_id', sessionId).neq('status', 'cancelled').order('created_at')
    const list = bk ?? []
    // 指名/加購對象獄卒 id → 顯示名(分開查 profiles 再 JS 合併)
    const gids = new Set()
    for (const b of list) {
      for (const p of arr(b.requested_slots)) if (p?.g) gids.add(p.g)
      for (const a of arr(b.addons)) if (a?.g) gids.add(a.g)
    }
    if (gids.size) {
      const { data: gp } = await supabase.from('profiles').select('id, game_name, display_name').in('id', [...gids])
      const gm = {}; for (const p of gp ?? []) gm[p.id] = p.game_name || p.display_name || '獄卒'
      setGuardNames(gm)
    } else setGuardNames({})
    setRows(list); setLoading(false)
  }
  useEffect(() => { load() }, [sessionId])

  async function toggleArrived(b) {
    const snapshot = rows
    setRows(prev => prev.map(x => x.id === b.id ? { ...x, arrived: !x.arrived } : x))
    const { error } = await supabase.from('bookings').update({ arrived: !b.arrived }).eq('id', b.id)
    if (error) { setRows(snapshot); setMsg('更新失敗，已還原：' + error.message); return }
    setMsg(b.arrived ? '已取消到場' : '已標記到場')
  }

  const nameOf = b => b.game_name || b.dc_name || '（未填暱稱）'
  const gName = id => guardNames[id] ?? '獄卒'

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
                  const picks = arr(b.requested_slots)
                  const addons = arr(b.addons).filter(a => a && (a.polaroid > 0 || a.sign > 0))
                  const cap = b.capture && typeof b.capture === 'object' ? b.capture : null
                  return (
                    <div key={b.id} className={`visit-row${b.arrived ? '' : ' done'}`}>
                      <div className="visit-text">
                        <span className="visit-who">
                          {b.arrived ? '✅' : '⬜'} {nameOf(b)}
                          {!b.user_id && <span className="tag tag-pill" style={{ background: 'rgba(255,255,255,.12)', color: 'var(--dim, #aaa)', marginLeft: 6 }}>訪客</span>}
                        </span>
                        <span className="visit-body">
                          {picks.length === 0 ? <span className="faint">不指定（由典獄長安排）</span>
                            : picks.map((p, i) => (
                              <span key={i} className="tag tag-pill" style={{ background: 'rgba(180,120,255,.16)', color: '#c2a3ff', marginRight: 6 }}>
                                {gName(p.g)}{p.s != null ? `（${slotLabel(startTime, p.s)}）` : '（監督）'}
                              </span>
                            ))}
                        </span>
                        {addons.length > 0 && (
                          <span className="visit-body">
                            {addons.map((a, i) => (
                              <span key={i} className="tag tag-pill" style={{ background: 'rgba(63,140,255,.14)', color: '#7fb0ff', marginRight: 6 }}>
                                {gName(a.g)}：拍立得 {a.polaroid || 0}{a.sign ? ` · 簽繪 ${a.sign}` : ''}
                              </span>
                            ))}
                          </span>
                        )}
                        {cap && (
                          <span className="visit-body">
                            <span className="tag tag-pill" style={{ background: 'rgba(216,65,47,.14)', color: '#e88' }}>
                              抓捕：委託 {cap.client || '?'} → {cap.target || '?'}（{cap.server || '?'}）
                            </span>
                          </span>
                        )}
                      </div>
                      <span className="spacer" />
                      <div className="visit-acts">
                        <button className={`btn-sm${b.arrived ? ' btn-pri' : ''}`} onClick={() => toggleArrived(b)}>
                          {b.arrived ? '✓ 已到場' : '標記到場'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
        <p className="settle-note">加購/抓捕為預約下單意向;實際收費與薪資結算以典獄長登錄的加購紀錄(purchase_addons)為準。</p>
      </div>
    </div>
  )
}

function arr(v) { return Array.isArray(v) ? v : [] }
