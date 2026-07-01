import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { SESSION_KIND_LABEL, DEFAULT_SESSION_KIND } from '../sessionKind'
import { calcSettlement, money } from './salaryRules'

// 場次薪資結算(僅典獄長,唯讀):讀 pos_order_items,依 salaryRules 逐筆算每位獄卒薪資與監獄收支。
// 只計算顯示,不寫入。金額「萬」整數。已移除 purchase_addons 與監獄外抓捕。
// 資料來源(分開查詢再 JS 合併):上班獄卒 ← session_guards + profiles;品項 ← pos_order_items。

// 金額欄:固定寬右對齊(不同位數對齊成一直排)
const Amt = ({ v, neg = false, strong = false }) => (
  <span className={`pay-amt${neg ? ' neg' : ''}${strong ? ' strong' : ''}`}>{money(v)}</span>
)

export default function SalarySettlement({ currentSession, embedded = false }) {
  const [allSessions, setAllSessions] = useState([])
  const [sid, setSid] = useState(currentSession || '')
  const [guards, setGuards] = useState([])   // [{id, name}]
  const [items, setItems] = useState([])     // pos_order_items
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('sessions').select('id, title, session_date, kind').order('created_at', { ascending: false })
      setAllSessions(data ?? [])
      setSid(prev => prev || currentSession || (data?.[0]?.id ?? ''))
    })()
  }, [currentSession])

  // 內嵌於進行中場次時,永遠跟隨當前場次(不顯示自己的選單)
  useEffect(() => { if (embedded && currentSession) setSid(currentSession) }, [embedded, currentSession])

  const sessionObj = allSessions.find(s => s.id === sid)
  const kind = sessionObj?.kind || DEFAULT_SESSION_KIND

  async function loadSession(id) {
    if (!id) { setGuards([]); setItems([]); return }
    setLoading(true)
    const [{ data: sg }, { data: it }, { data: ords }] = await Promise.all([
      supabase.from('session_guards').select('guard_id').eq('session_id', id),
      supabase.from('pos_order_items').select('order_id, item_type, person_name, target_guard_id, qty, with_signature, amount, visitor_name, slot_times, supervise').eq('session_id', id),
      supabase.from('pos_orders').select('id, customer_name').eq('session_id', id),
    ])
    // 每筆品項附上本單犯人(_customer):肖像/探監用 person_name,拍立得/指名用訂單的 customer_name
    const custById = {}; for (const o of ords ?? []) custById[o.id] = o.customer_name
    const itemsC = (it ?? []).map(x => ({ ...x, _customer: x.person_name || custById[x.order_id] || null }))
    // 上班獄卒 ∪ 有 POS 品項的獄卒(避免排班變動後漏算)
    const gids = [...new Set([...(sg ?? []).map(r => r.guard_id), ...itemsC.map(r => r.target_guard_id).filter(Boolean)])]
    let gList = []
    if (gids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, game_name, display_name, inmate_no').in('id', gids)
      const byId = {}; for (const p of profs ?? []) byId[p.id] = p
      gList = gids.map(g => ({ id: g, name: byId[g]?.game_name || byId[g]?.display_name || '獄卒', inmate_no: byId[g]?.inmate_no ?? 1e9 }))
        .sort((a, b) => a.inmate_no - b.inmate_no)   // 獄卒依犯人編號排序
    }
    setGuards(gList)
    setItems(itemsC)
    setLoading(false)
  }
  useEffect(() => { loadSession(sid) }, [sid])

  const result = useMemo(() => calcSettlement({ kind, guards, items }), [kind, guards, items])
  const isFree = kind === 'free'

  return (
    <div className="settle-wrap">
      {!embedded && (
        <div className="card-panel" style={{ marginBottom: 16 }}>
          <div className="head"><h2>場次薪資結算</h2><span className="count">只計算顯示 · 讀 POS</span></div>
          <div className="body">
            <div className="settle-tools">
              <label>結算場次
                <select className="sel" value={sid} onChange={e => setSid(e.target.value)} style={{ minWidth: 220 }}>
                  <option value="">— 選擇場次 —</option>
                  {allSessions.map(s => <option key={s.id} value={s.id}>{s.title}{s.session_date ? `（${s.session_date}）` : ''}</option>)}
                </select>
              </label>
              <span className="tag tag-pill" style={{ background: 'rgba(180,120,255,.14)', color: '#c2a3ff' }}>{SESSION_KIND_LABEL[kind] ?? kind}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="btn-sm btn-pri" onClick={() => loadSession(sid)} disabled={!sid || loading}>{loading ? '計算中…' : '↻ 重新計算'}</button>
            </div>
          </div>
        </div>
      )}

      {!sid ? (embedded ? null : <p className="empty">請先選擇場次</p>)
        : isFree ? <p className="empty">自由入場場無獄卒管理，不進行薪資結算。</p>
          : (<>
            {/* 整場總覽(4 數字速覽) */}
            <div className="settle-overview">
              <div className="ov-cell"><span className="ov-lbl">當日營業額</span><span className="ov-num">{money(result.revenue)}</span></div>
              <div className="ov-cell"><span className="ov-lbl">獄卒基礎薪資</span><span className="ov-num">{money(result.directTotal)}</span></div>
              <div className="ov-cell"><span className="ov-lbl">獎金（均分獎金池）</span><span className="ov-num">{money(result.pool)}</span></div>
              <div className="ov-cell hl"><span className="ov-lbl">監獄留存</span><span className={`ov-num${result.retain < 0 ? ' neg' : ''}`}>{money(result.retain)}</span></div>
            </div>

            {/* A. 人員薪資卡(網格並排) */}
            <div className="pay-sec-lbl">獄卒薪資明細<span className="ln" /><span className="pay-sec-count">{result.guards.length} 位</span></div>
            {result.guards.length === 0 ? <p className="empty">本場沒有上班獄卒</p> : (
              <div className="pay-cards">
                {result.guards.map(g => (
                  <div key={g.id} className="pay-card">
                    <div className="pay-card-head">
                      <span className="pc-name">{g.name}</span>
                      <span className="pc-final">{money(g.final)}</span>
                    </div>
                    <div className="pay-card-body">
                      {g.segments.map((seg, i) => (
                        <div key={i} className="pay-seg">
                          <div className="pay-seg-head">
                            <span className="ps-title">{seg.title}{seg.note ? <span className="ps-note">（{seg.note}）</span> : null}</span>
                            <Amt v={seg.amount} />
                          </div>
                          {seg.rows?.map((r, j) => (
                            <div key={j} className="pay-row">
                              <span className="pr-name">{r.name}</span>
                              {r.tag && <span className="pr-tag">{r.tag}</span>}
                              {r.calc && <span className="pr-calc mono">{r.calc}</span>}
                              <Amt v={r.amount} />
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="pay-card-foot"><span>最終薪資</span><Amt v={g.final} strong /></div>
                  </div>
                ))}
              </div>
            )}

            {/* B. 監獄收支卡 */}
            <div className="pay-sec-lbl">監獄收支<span className="ln" /></div>
            <div className="prison-card">
              <div className="prison-block">
                <div className="pb-title">營業額來源</div>
                {result.revenueRows.length === 0 ? <div className="prison-row"><span>—</span><Amt v={0} /></div>
                  : result.revenueRows.map((r, i) => (
                    <div key={i} className="prison-row"><span>{r.label}</span><Amt v={r.amount} /></div>
                  ))}
                <div className="prison-row sum"><span>營業額合計</span><Amt v={result.revenue} strong /></div>
              </div>
              <div className="prison-block">
                <div className="pb-title">結算</div>
                <div className="prison-row"><span>獄卒直接薪資</span><Amt v={-result.directTotal} neg /></div>
                <div className="prison-row sum"><span>淨收入（營業額 − 直接薪資）</span><Amt v={result.net} neg={result.net < 0} /></div>
                <div className="prison-row"><span>均分獎金池（淨收 50%，發給獄卒）</span><Amt v={-result.pool} neg /></div>
                <div className="prison-row hl"><span>監獄留存（淨收 50%，用於後續活動經費）</span><Amt v={result.retain} neg={result.retain < 0} strong /></div>
              </div>
            </div>
            <p className="settle-note">資料來源 POS 結帳(pos_order_items)。金額單位「萬」。此頁僅計算顯示，不寫入。</p>
          </>)}
    </div>
  )
}
