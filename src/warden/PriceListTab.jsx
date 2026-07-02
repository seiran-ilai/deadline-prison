import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { DEFAULT_PRICES } from '../prices'
import { SESSION_KIND_LABEL } from '../sessionKind'

// 品項價目表(僅典獄長):依場次類型分類,每品項有「定價 / 優惠價 / 獄卒得」欄位。
// 有優惠價時官網顯示定價劃線+優惠價;POS 結帳可選擇以優惠價或定價結帳。
// 獄卒得 = 每單位拆帳(薪資結算讀此欄;留空 = 不參與拆帳);監獄得 = 實收 − 獄卒得(自動計算顯示)。
// 優惠結帳不影響薪資結算:獄卒仍照「獄卒得」拿,優惠差額由監獄吸收。
// 資料表 price_items 未建(遷移未跑)時提示先執行 SQL;「載入預設價目」可一鍵補種子。
export default function PriceListTab({ setMsg }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [draft, setDraft] = useState({})        // id -> { name, list_price, sale_price }(編輯中的值)
  const [confirmDel, setConfirmDel] = useState(null)
  const [adding, setAdding] = useState(null)    // { kind, item_key, name, list_price, sale_price } | null
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('price_items')
      .select('id, kind, item_key, name, unit, list_price, sale_price, guard_cut, sort_order')
      .order('kind').order('sort_order')
    if (error) { setTableMissing(true); setRows([]); setLoading(false); return }
    setTableMissing(false)
    setRows((data ?? []).map(r => ({ ...r, list_price: Number(r.list_price), sale_price: r.sale_price == null ? null : Number(r.sale_price), guard_cut: r.guard_cut == null ? null : Number(r.guard_cut) })))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // 種子:把 DEFAULT_PRICES 中資料庫還沒有的鍵補進去
  async function seedDefaults() {
    setBusy(true)
    const have = new Set(rows.map(r => `${r.kind}|${r.item_key}`))
    const missing = DEFAULT_PRICES.filter(d => !have.has(`${d.kind}|${d.item_key}`))
    if (!missing.length) { setBusy(false); setMsg('預設品項都已存在'); return }
    const { error } = await supabase.from('price_items').insert(missing.map(d => ({
      kind: d.kind, item_key: d.item_key, name: d.name, unit: d.unit,
      list_price: d.list_price, sale_price: d.sale_price, guard_cut: d.guard_cut ?? null, sort_order: d.sort_order,
    })))
    setBusy(false)
    if (error) { setMsg('載入預設價目失敗：' + error.message); return }
    setMsg(`已載入 ${missing.length} 項預設價目`)
    load()
  }

  const dv = (r, field) => {
    const d = draft[r.id]
    if (d && field in d) return d[field]
    return (field === 'sale_price' || field === 'guard_cut') ? (r[field] ?? '') : r[field]
  }
  const setDv = (id, field, v) => setDraft(prev => ({ ...prev, [id]: { ...prev[id], [field]: v } }))
  const dirty = (r) => {
    const d = draft[r.id]
    if (!d) return false
    const name = 'name' in d ? d.name : r.name
    const lp = 'list_price' in d ? d.list_price : r.list_price
    const sp = 'sale_price' in d ? d.sale_price : (r.sale_price ?? '')
    const gc = 'guard_cut' in d ? d.guard_cut : (r.guard_cut ?? '')
    return name !== r.name || String(lp) !== String(r.list_price) || String(sp) !== String(r.sale_price ?? '') || String(gc) !== String(r.guard_cut ?? '')
  }

  async function saveRow(r) {
    const name = String(dv(r, 'name')).trim()
    const lp = Number(dv(r, 'list_price'))
    const spRaw = String(dv(r, 'sale_price')).trim()
    const sp = spRaw === '' ? null : Number(spRaw)
    const gcRaw = String(dv(r, 'guard_cut')).trim()
    const gc = gcRaw === '' ? null : Number(gcRaw)
    if (!name) { setMsg('品項名稱必填'); return }
    if (!Number.isFinite(lp) || lp < 0) { setMsg('定價需為 0 以上的數字'); return }
    if (sp != null && (!Number.isFinite(sp) || sp < 0)) { setMsg('優惠價需為 0 以上的數字或留空'); return }
    if (gc != null && (!Number.isFinite(gc) || gc < 0)) { setMsg('獄卒得需為 0 以上的數字或留空'); return }
    // 樂觀更新 + 失敗回滾
    const snapshot = rows
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, name, list_price: lp, sale_price: sp, guard_cut: gc } : x))
    setDraft(prev => { const n = { ...prev }; delete n[r.id]; return n })
    const { error } = await supabase.from('price_items')
      .update({ name, list_price: lp, sale_price: sp, guard_cut: gc }).eq('id', r.id)
    if (error) { setRows(snapshot); setMsg('儲存失敗，已還原：' + error.message); return }
    setMsg(`已更新「${name}」價格`)
  }

  async function removeRow(r) {
    setConfirmDel(null)
    const snapshot = rows
    setRows(prev => prev.filter(x => x.id !== r.id))
    const { error } = await supabase.from('price_items').delete().eq('id', r.id)
    if (error) { setRows(snapshot); setMsg('刪除失敗，已還原：' + error.message); return }
    setMsg(`已刪除「${r.name}」`)
  }

  async function addRow() {
    const a = adding
    const key = String(a.item_key || '').trim()
    const name = String(a.name || '').trim()
    const lp = Number(a.list_price)
    const sp = String(a.sale_price ?? '').trim() === '' ? null : Number(a.sale_price)
    const gc = String(a.guard_cut ?? '').trim() === '' ? null : Number(a.guard_cut)
    if (!key || !name) { setMsg('品項鍵與名稱必填'); return }
    if (!Number.isFinite(lp) || lp < 0) { setMsg('定價需為 0 以上的數字'); return }
    setBusy(true)
    const maxOrder = rows.filter(r => r.kind === a.kind).reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0)
    const { data, error } = await supabase.from('price_items')
      .insert({ kind: a.kind, item_key: key, name, unit: a.unit || '萬', list_price: lp, sale_price: sp, guard_cut: gc, sort_order: maxOrder + 1 })
      .select('id, kind, item_key, name, unit, list_price, sale_price, guard_cut, sort_order').single()
    setBusy(false)
    if (error) { setMsg('新增失敗：' + error.message); return }
    setRows(prev => [...prev, { ...data, list_price: Number(data.list_price), sale_price: data.sale_price == null ? null : Number(data.sale_price), guard_cut: data.guard_cut == null ? null : Number(data.guard_cut) }])
    setAdding(null)
    setMsg(`已新增「${name}」`)
  }

  if (loading) return <p className="empty">載入價目表中…</p>
  if (tableMissing) return (
    <div className="card-panel">
      <div className="head"><h2>品項價目表</h2></div>
      <div className="body">
        <p className="empty">尚未建立價目表資料表。請先在 Supabase SQL Editor 執行
          <code style={{ margin: '0 6px' }}>supabase/add_price_items_and_pos_list_amount.sql</code>
          後重新整理本頁。未建表前,系統各處沿用內建預設價格。</p>
      </div>
    </div>
  )

  return (
    <div>
      <h3>品項價目表</h3>
      <p className="muted" style={{ marginBottom: 12 }}>
        有優惠價的品項:官網顯示「定價劃線＋優惠價」,POS 結帳可選擇以優惠價或定價結帳;優惠價留空 = 一律定價。
        「獄卒得」= 每單位拆帳,薪資結算依此計算(留空 = 不參與拆帳);「監獄得」= 售價 − 獄卒得(自動計算)。
        優惠結帳不影響薪資結算:獄卒仍照「獄卒得」拿,優惠差額由監獄吸收。金額單位:萬。
      </p>
      {['crunch', 'named', 'free'].map(kind => {
        const list = rows.filter(r => r.kind === kind).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        if (kind === 'free' && list.length === 0 && adding?.kind !== 'free') return null   // 自由入場通常免費,無品項就不顯示空表
        return (
          <div key={kind} className="card-panel" style={{ marginBottom: 16 }}>
            <div className="head">
              <h2>{SESSION_KIND_LABEL[kind]}</h2><span className="count">{list.length} 項</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button className="btn-sm" onClick={() => setAdding({ kind, item_key: '', name: '', unit: '萬', list_price: '', sale_price: '', guard_cut: '' })}>＋ 新增品項</button>
            </div>
            <div className="body">
              {list.length === 0 ? <p className="empty">尚無品項</p> : (
                <table className="settle-table detail">
                  <thead><tr><th>品項</th><th>單位</th><th>定價</th><th>優惠價</th><th>獄卒得</th><th>監獄得</th><th></th><th></th></tr></thead>
                  <tbody>
                    {list.map(r => {
                      // 監獄得 = 售價 − 獄卒得(依編輯中的值即時計算;有優惠價時兩種售價都列)
                      const num = (v) => { const s = String(v).trim(); return s === '' ? null : Number(s) }
                      const lp = num(dv(r, 'list_price')) ?? 0
                      const sp = num(dv(r, 'sale_price'))
                      const gc = num(dv(r, 'guard_cut'))
                      const rnd = (n) => Math.round(n * 100) / 100
                      return (
                        <tr key={r.id}>
                          <td><input className="inp" style={{ minWidth: 140 }} value={dv(r, 'name')} onChange={e => setDv(r.id, 'name', e.target.value)} /></td>
                          <td className="faint">{r.unit ?? '萬'}</td>
                          <td><input className="inp" type="number" min="0" style={{ width: 80 }} value={dv(r, 'list_price')} onChange={e => setDv(r.id, 'list_price', e.target.value)} /></td>
                          <td><input className="inp" type="number" min="0" style={{ width: 80 }} placeholder="無優惠" value={dv(r, 'sale_price')} onChange={e => setDv(r.id, 'sale_price', e.target.value)} /></td>
                          <td><input className="inp" type="number" min="0" step="0.5" style={{ width: 80 }} placeholder="不拆帳" value={dv(r, 'guard_cut')} onChange={e => setDv(r.id, 'guard_cut', e.target.value)} /></td>
                          <td className="mono">
                            {gc == null ? <span className="faint">—</span> : (
                              <>
                                {rnd(lp - gc)} 萬
                                {sp != null && <div className="faint" style={{ fontSize: 11 }}>優惠時 {rnd(sp - gc)} 萬</div>}
                              </>
                            )}
                          </td>
                          <td>{dirty(r) && <button className="btn-sm btn-pri" onClick={() => saveRow(r)}>儲存</button>}</td>
                          <td>{confirmDel === r.id
                            ? <span style={{ display: 'inline-flex', gap: 4 }}><button className="btn-sm btn-danger" onClick={() => removeRow(r)}>確認</button><button className="btn-sm" onClick={() => setConfirmDel(null)}>取消</button></span>
                            : <button className="btn-sm btn-danger" onClick={() => setConfirmDel(r.id)}>刪</button>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {adding?.kind === kind && (
                <div className="toolbar" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <input className="inp" style={{ width: 130 }} placeholder="品項鍵（英文）" value={adding.item_key} onChange={e => setAdding({ ...adding, item_key: e.target.value })} />
                  <input className="inp" style={{ width: 160 }} placeholder="品項名稱" value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} />
                  <input className="inp" style={{ width: 90 }} placeholder="單位" value={adding.unit} onChange={e => setAdding({ ...adding, unit: e.target.value })} />
                  <input className="inp" type="number" min="0" style={{ width: 90 }} placeholder="定價" value={adding.list_price} onChange={e => setAdding({ ...adding, list_price: e.target.value })} />
                  <input className="inp" type="number" min="0" style={{ width: 90 }} placeholder="優惠價" value={adding.sale_price} onChange={e => setAdding({ ...adding, sale_price: e.target.value })} />
                  <input className="inp" type="number" min="0" step="0.5" style={{ width: 90 }} placeholder="獄卒得" value={adding.guard_cut} onChange={e => setAdding({ ...adding, guard_cut: e.target.value })} />
                  <button className="btn-pri btn-sm" disabled={busy} onClick={addRow}>新增</button>
                  <button className="btn-sm" onClick={() => setAdding(null)}>取消</button>
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div className="toolbar">
        <button className="btn-sm" disabled={busy} onClick={seedDefaults}>載入預設價目（補缺的品項）</button>
      </div>
    </div>
  )
}
