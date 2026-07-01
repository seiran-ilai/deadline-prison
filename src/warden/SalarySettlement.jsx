import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../supabaseClient'
import { SESSION_KIND_LABEL, DEFAULT_SESSION_KIND } from '../sessionKind'
import { calcSettlement, money } from './salaryRules'

// 場次薪資結算(僅典獄長,唯讀):針對單一 session 一鍵計算每位獄卒薪資與監獄收支。
// 此版本只計算與顯示,不寫入任何薪資表。金額一律以「萬」為單位(與站上金額顯示慣例一致)。
// 規則集中在 ./salaryRules.js 的 calcSettlement,方便日後改價。
//
// 資料來源(皆「分開查詢再於 JS 合併」,不用巢狀 relation):
//   出勤獄卒 ← session_inmates(role_in_session='guard')+ profiles
//   加購紀錄 ← purchase_addons(addon_type/target_guard_id/with_signature/amount)  ※表可能尚未建立,防呆:讀不到以空陣列計並示警
//   指名時段數 ← bookings(requested_guard_id + requested_slot,未取消;每筆=一個 30 分時格)
//   抓捕參與 ← 介面勾選(可多選),不來自資料表

export default function SalarySettlement({ currentSession }) {
  const [allSessions, setAllSessions] = useState([])
  const [sid, setSid] = useState(currentSession || '')
  const [guards, setGuards] = useState([])          // [{id, name}]
  const [addons, setAddons] = useState([])          // purchase_addons 列
  const [slotsByGuard, setSlotsByGuard] = useState({}) // guard_id -> 指名時段數
  const [captureSet, setCaptureSet] = useState(new Set()) // 勾選參與抓捕的 guard_id
  const [addonWarn, setAddonWarn] = useState(false) // purchase_addons 讀取失敗/未建立
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(new Set())

  // 場次清單(全部場次,可結算已結束場)。預設帶入當前場次。
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('sessions')
        .select('id, title, session_date, kind, status').order('created_at', { ascending: false })
      setAllSessions(data ?? [])
      setSid(prev => prev || currentSession || (data?.[0]?.id ?? ''))
    })()
  }, [currentSession])

  const sessionObj = allSessions.find(s => s.id === sid)
  const kind = sessionObj?.kind || DEFAULT_SESSION_KIND

  async function loadSession(id) {
    if (!id) { setGuards([]); setAddons([]); setSlotsByGuard({}); return }
    setLoading(true)
    // 1) 出勤獄卒:session_inmates(guard)→ profiles(分開查再合併)
    const { data: si } = await supabase.from('session_inmates')
      .select('member_id, role_in_session').eq('session_id', id).eq('role_in_session', 'guard')
    const gids = (si ?? []).map(r => r.member_id)
    let gList = []
    if (gids.length) {
      const { data: profs } = await supabase.from('profiles')
        .select('id, game_name, display_name').in('id', gids)
      const byId = {}; for (const p of profs ?? []) byId[p.id] = p
      gList = gids.map(gid => ({ id: gid, name: byId[gid]?.game_name || byId[gid]?.display_name || '獄卒' }))
    }
    setGuards(gList)

    // 2) 加購紀錄:purchase_addons(防呆:表未建立/讀取失敗 → 空陣列並示警)
    const { data: ad, error: adErr } = await supabase.from('purchase_addons')
      .select('addon_type, target_guard_id, with_signature, amount, inmate_id').eq('session_id', id)
    if (adErr) { setAddons([]); setAddonWarn(true) } else { setAddons(ad ?? []); setAddonWarn(false) }

    // 3) 指名時段數:bookings(requested_guard_id + 未取消;每筆=一個時格)
    const { data: bk } = await supabase.from('bookings')
      .select('requested_guard_id, requested_slot, status').eq('session_id', id)
    const slots = {}
    for (const b of bk ?? []) {
      if (b.status === 'cancelled') continue
      if (b.requested_guard_id == null || b.requested_slot == null) continue
      slots[b.requested_guard_id] = (slots[b.requested_guard_id] || 0) + 1
    }
    setSlotsByGuard(slots)

    setCaptureSet(new Set())   // 換場清空抓捕勾選
    setExpanded(new Set())
    setLoading(false)
  }
  useEffect(() => { loadSession(sid) }, [sid])

  const result = useMemo(
    () => calcSettlement({ kind, guards, addons, slotsByGuard, captureSet }),
    [kind, guards, addons, slotsByGuard, captureSet],
  )

  const isCrunch = kind === 'crunch'
  const isFree = kind === 'free'

  function toggleCapture(gid) {
    setCaptureSet(prev => { const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n })
  }
  function toggleExpand(gid) {
    setExpanded(prev => { const n = new Set(prev); n.has(gid) ? n.delete(gid) : n.add(gid); return n })
  }

  return (
    <div>
      {/* 選場 + 重新計算 */}
      <div className="card-panel" style={{ marginBottom: 16 }}>
        <div className="head">
          <h2>場次薪資結算</h2>
          <span className="count">只計算顯示 · 不寫入</span>
        </div>
        <div className="body">
          <div className="settle-tools">
            <label>結算場次
              <select className="sel" value={sid} onChange={e => setSid(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">— 選擇場次 —</option>
                {allSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.title}{s.session_date ? `（${s.session_date}）` : ''}</option>
                ))}
              </select>
            </label>
            <span className="tag tag-pill" style={{ background: 'rgba(180,120,255,.14)', color: '#c2a3ff' }}>
              {SESSION_KIND_LABEL[kind] ?? kind}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <button className="btn-sm btn-pri" onClick={() => loadSession(sid)} disabled={!sid || loading}>
              {loading ? '計算中…' : '↻ 重新計算'}
            </button>
          </div>
          {addonWarn && (
            <p className="settle-warn">⚠ 讀不到 <code>purchase_addons</code>（資料表尚未建立或無讀取權限）。拍立得／肖像畫／監督／探監／入場／指名費等加購數字一律以 0 計，待建表後即會反映。</p>
          )}
        </div>
      </div>

      {!sid ? <p className="empty">請先選擇要結算的場次</p>
        : isFree ? <p className="empty">自由入場場無獄卒管理，不進行薪資結算。</p>
          : (<>
            {/* 抓捕參與(集體場才需要;指名場公式不含抓捕) */}
            {isCrunch && (
              <div className="card-panel" style={{ marginBottom: 16 }}>
                <div className="head"><h2>抓捕劇場參與</h2><span className="count">15 萬／人（監獄 10・本人 5）</span></div>
                <div className="body">
                  {guards.length === 0 ? <p className="empty">本場沒有出勤獄卒</p> : (
                    <div className="settle-capture">
                      {guards.map(g => (
                        <label key={g.id} className={`cap-chip${captureSet.has(g.id) ? ' on' : ''}`}>
                          <input type="checkbox" checked={captureSet.has(g.id)} onChange={() => toggleCapture(g.id)} />
                          {g.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 整場總覽 */}
            <div className="card-panel" style={{ marginBottom: 16 }}>
              <div className="head"><h2>整場總覽</h2><span className="count">出勤獄卒 {guards.length} 人</span></div>
              <div className="body">
                <table className="settle-table overview">
                  <tbody>
                    <tr><th>當日營業額</th><td>{money(result.revenue)}</td></tr>
                    <tr><th>獄卒薪資總額</th><td>{money(result.salaryTotal)}</td></tr>
                    {isCrunch ? (<>
                      <tr><th>監獄毛收入</th><td>{money(result.gross)}</td></tr>
                      <tr><th>共享獎金池（毛收入 × 50%）</th><td>{money(result.pool)}</td></tr>
                      <tr><th>每人均分（÷ {guards.length || 0} 人）</th><td>{money(result.perPool)}</td></tr>
                      <tr><th>監獄留存（毛收入 × 50%）</th><td>{money(result.retain)}</td></tr>
                    </>) : (
                      <tr><th>監獄結餘（可能為負）</th><td className={result.balance < 0 ? 'neg' : ''}>{money(result.balance)}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 每位獄卒明細 */}
            <div className="card-panel">
              <div className="head"><h2>每位獄卒明細</h2><span className="count">{result.guards.length} 位</span></div>
              <div className="body">
                {result.guards.length === 0 ? <p className="empty">本場沒有出勤獄卒</p> : (
                  <table className="settle-table detail">
                    <thead>
                      <tr><th>獄卒</th><th>直接薪資</th>{isCrunch && <th>均分獎金</th>}<th>最終薪資</th><th></th></tr>
                    </thead>
                    <tbody>
                      {result.guards.map(g => {
                        const open = expanded.has(g.id)
                        return (
                          <Fragment key={g.id}>
                            <tr className="g-row">
                              <td className="g-name">{g.name}{g.portrait > 0 && <span className="g-tag">肖像畫</span>}</td>
                              <td>{money(g.direct)}</td>
                              {isCrunch && <td>{money(g.pool)}</td>}
                              <td className="g-final">{money(g.final)}</td>
                              <td><button className="btn-sm" onClick={() => toggleExpand(g.id)}>{open ? '收合' : '明細'}</button></td>
                            </tr>
                            {open && (
                              <tr className="g-detail">
                                <td colSpan={isCrunch ? 5 : 4}>
                                  <ul className="settle-lines">
                                    {g.lines.map((ln, i) => (
                                      <li key={i}><span className="ln-lbl">{ln.label}</span><span className="ln-det">{ln.detail}</span><span className="ln-amt">{money(ln.amount)}</span></li>
                                    ))}
                                    <li className="ln-sub"><span className="ln-lbl">直接薪資小計</span><span className="ln-det" /><span className="ln-amt">{money(g.direct)}</span></li>
                                    {isCrunch && <li className="ln-sub"><span className="ln-lbl">均分獎金</span><span className="ln-det">池 ÷ {guards.length || 0}</span><span className="ln-amt">{money(g.pool)}</span></li>}
                                    <li className="ln-total"><span className="ln-lbl">最終薪資</span><span className="ln-det" /><span className="ln-amt">{money(g.final)}</span></li>
                                  </ul>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                <p className="settle-note">共通：小費不列入結算。金額單位為「萬」。此頁僅計算與顯示，不寫入任何薪資表。</p>
              </div>
            </div>
          </>)}
    </div>
  )
}
