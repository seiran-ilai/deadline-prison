import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import MessageBanner from './MessageBanner'
import { computeProgress } from './progress'
import { askConfirm } from './ConfirmDialog'

// 優先序設定:1高 2中 3低(SessionGoals 與導覽示範頁共用)
export const PRIORITY = {
  1: { label: '高', color: '#fff', bg: '#d9534f' },
  2: { label: '中', color: '#fff', bg: '#e08e0b' },
  3: { label: '低', color: '#fff', bg: '#888' },
}
// 稿件一律只有本人 + 負責獄卒 + 典獄長可見(不對同場犯人公開);隱私設定已移除。
const blankForm = { title: '', priority: 2, due_date: '', target_date: '' }

function PriorityTag({ priority }) {
  const p = PRIORITY[priority] ?? PRIORITY[2]
  return (
    <span style={{ background: p.bg, color: p.color, fontSize: 12, padding: '1px 8px', borderRadius: 10 }}>
      {p.label}
    </span>
  )
}

// 進度條:吃 computeProgress() 的統一結果。
// 有子項目 → 顯示「done/total（x%）」;無子項目 → 顯示「x%」(由 is_done 決定 0/100)。
export function ProgressBar({ progress }) {
  const { done = 0, total = 0, pct = 0, hasSteps = false } = progress ?? {}
  const p = Math.round(pct * 100)
  return (
    <div className="ad-progress">
      <div className="track">
        <div className={`fill${p === 100 ? ' done' : ''}`} style={{ width: `${p}%` }} />
      </div>
      <span className="pct">{hasSteps ? `${done}/${total}（${p}%）` : `${p}%`}</span>
    </div>
  )
}

// 依 due_date 與今天比較,算出死線標記(RP 用語)。
// pct = 完成度(0~1);完成度 100% 時不顯示逾期/緊迫警示,只低調顯示日期。
function deadlineInfo(dueDate, pct) {
  if (!dueDate) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00'); due.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due - today) / 86400000)
  const complete = pct >= 1
  if (diffDays < 0) {
    if (complete) return { text: `截止日：${dueDate}`, tone: 'muted' }
    return { text: `死線已破 · 逾期 ${-diffDays} 天`, tone: 'danger' }
  }
  if (diffDays <= 3) {
    if (complete) return { text: `截止日：${dueDate}`, tone: 'muted' }
    return { text: diffDays === 0 ? '死線今天' : `死線還剩 ${diffDays} 天`, tone: 'warn' }
  }
  return { text: `還剩 ${diffDays} 天`, tone: 'muted' }   // 一般(> 3 天):低調
}

const DEADLINE_TONE = {
  danger: { bg: '#d9534f', color: '#fff' },
  warn: { bg: '#e08e0b', color: '#fff' },
  muted: { bg: 'rgba(255,255,255,.08)', color: '#9298a2' },
}

function DeadlineBadge({ dueDate, pct }) {
  const info = deadlineInfo(dueDate, pct)
  if (!info) return null
  const t = DEADLINE_TONE[info.tone]
  return (
    <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: t.bg, color: t.color }}>
      {info.text}
    </span>
  )
}

export default function ManuscriptManager({ userId }) {
  const [view, setView] = useState('active')      // 'active' | 'archived'
  const [sortBy, setSortBy] = useState('due')     // 'due'(截止日) | 'progress'(完成度) | 'priority'(優先級)
  const [manuscripts, setManuscripts] = useState([])
  const [stepsByMs, setStepsByMs] = useState({})  // { manuscript_id: [step, ...] }
  const [expanded, setExpanded] = useState([])    // 展開中的稿件 id
  const [form, setForm] = useState(blankForm)     // 新增稿件表單
  const [newStep, setNewStep] = useState({})      // { manuscript_id: 子項目輸入字串 }
  const [editing, setEditing] = useState(null)    // 編輯中的稿件(modal 用)
  const [msg, setMsg] = useState('')

  async function load() {
    const { data: ms, error } = await supabase.from('manuscripts')
      .select('id, title, priority, due_date, target_date, status, is_done, created_at')
      .eq('member_id', userId).eq('status', view)
      .order('priority').order('created_at')
    if (error) { setMsg('載入失敗：' + error.message); return }
    setManuscripts(ms ?? [])
    const ids = (ms ?? []).map(m => m.id)
    if (ids.length === 0) { setStepsByMs({}); return }
    const { data: steps } = await supabase.from('manuscript_steps')
      .select('id, manuscript_id, title, done, sort_order, created_at')
      .in('manuscript_id', ids).order('sort_order').order('created_at')
    const grouped = {}
    for (const s of steps ?? []) (grouped[s.manuscript_id] ??= []).push(s)
    setStepsByMs(grouped)
  }
  useEffect(() => { if (userId) load() }, [userId, view])

  // ── 稿件 CRUD ─────────────────────────────
  async function addManuscript() {
    if (!form.title.trim()) { setMsg('稿件名必填'); return }
    const { error } = await supabase.from('manuscripts').insert({
      member_id: userId,
      title: form.title.trim(),
      priority: Number(form.priority),
      due_date: form.due_date || null,
      target_date: form.target_date || null,
      visibility: 'staff',   // 僅本人 + 負責獄卒 + 典獄長可見
    })
    if (error) { setMsg('新增失敗：' + error.message); return }
    setForm(blankForm); setMsg('已新增稿件'); load()
  }

  async function saveEdit() {
    if (!editing.title.trim()) { setMsg('稿件名必填'); return }
    const { error } = await supabase.from('manuscripts').update({
      title: editing.title.trim(),
      priority: Number(editing.priority),
      due_date: editing.due_date || null,
      target_date: editing.target_date || null,
      visibility: 'staff',
    }).eq('id', editing.id)
    if (error) { setMsg('更新失敗：' + error.message); return }
    setEditing(null); setMsg('已更新'); load()
  }

  async function deleteManuscript(id) {
    if (!await askConfirm({ title: '刪除稿件', message: '確定刪除這本稿件嗎？子項目也會一起刪除。', confirmLabel: '刪除', danger: true })) return
    // 先刪子項目,再刪稿件(避免外鍵殘留)
    await supabase.from('manuscript_steps').delete().eq('manuscript_id', id)
    const { error } = await supabase.from('manuscripts').delete().eq('id', id)
    if (error) { setMsg('刪除失敗：' + error.message); return }
    setMsg('已刪除稿件'); load()
  }

  async function setStatus(id, status) {
    const { error } = await supabase.from('manuscripts').update({ status }).eq('id', id)
    if (error) { setMsg('操作失敗：' + error.message); return }
    setMsg(status === 'archived' ? '已封存' : '已取回'); load()
  }

  // ── 子項目 CRUD ───────────────────────────
  async function toggleStep(step) {
    const { error } = await supabase.from('manuscript_steps')
      .update({ done: !step.done }).eq('id', step.id)
    if (error) { setMsg('更新失敗：' + error.message); return }
    load()
  }

  async function addStep(mid) {
    const title = (newStep[mid] ?? '').trim()
    if (!title) return
    const existing = stepsByMs[mid] ?? []
    const nextOrder = existing.length ? Math.max(...existing.map(s => s.sort_order ?? 0)) + 1 : 0
    const { error } = await supabase.from('manuscript_steps')
      .insert({ manuscript_id: mid, title, sort_order: nextOrder })
    if (error) { setMsg('新增子項目失敗：' + error.message); return }
    setNewStep({ ...newStep, [mid]: '' }); load()
  }

  async function deleteStep(stepId) {
    if (!await askConfirm({ title: '刪除子項目', message: '確定刪除這個子項目嗎？', confirmLabel: '刪除', danger: true })) return
    const { error } = await supabase.from('manuscript_steps').delete().eq('id', stepId)
    if (error) { setMsg('刪除失敗：' + error.message); return }
    load()
  }

  // 無子項目稿件:直接勾選整本完成(寫 manuscripts.is_done)
  async function toggleManuscriptDone(m) {
    const { error } = await supabase.from('manuscripts').update({ is_done: !m.is_done }).eq('id', m.id)
    if (error) { setMsg('更新失敗：' + error.message); return }
    load()
  }

  function toggleExpand(id) {
    setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // 完成度(0~1):統一邏輯(有子項目→done/total;無子項目→is_done)
  const progressOf = (m) => computeProgress({ steps: stepsByMs[m.id] ?? [], isDone: m.is_done }).pct

  // 排序(前端;各選項用固定預設方向)
  const sorted = [...manuscripts].sort((a, b) => {
    if (sortBy === 'priority') return (a.priority ?? 9) - (b.priority ?? 9)   // 高(1)→ 低(3)
    if (sortBy === 'progress') return progressOf(a) - progressOf(b)           // 低 → 高(未完成優先)
    // 截止日:有 due_date 者依日期近→遠(逾期最前);無 due_date 排最後
    const ad = a.due_date, bd = b.due_date
    if (ad && bd) return ad < bd ? -1 : ad > bd ? 1 : 0
    if (ad) return -1
    if (bd) return 1
    return 0
  })

  return (
    <div>
      {/* 檢視切換 + 排序 */}
      <div className="seg-tabs">
        <button className={view === 'active' ? 'on' : ''} onClick={() => setView('active')}>進行中</button>
        <button className={view === 'archived' ? 'on' : ''} onClick={() => setView('archived')}>已封存</button>
        <span className="spacer" />
        <label>排序
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="due">截止日</option>
            <option value="progress">完成度</option>
            <option value="priority">優先級</option>
          </select>
        </label>
      </div>

      {/* 新增稿件(僅進行中檢視顯示) */}
      {view === 'active' && (
        <div className="panel">
          <strong>新增稿件</strong>
          <div className="panel-form">
            <input className="inp" style={{ flex: '1 1 180px' }} placeholder="稿件名（必填）"
              value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <label>優先序
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </label>
            <label>截止日
              <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </label>
            <label>目標日
              <input type="date" value={form.target_date} onChange={e => setForm({ ...form, target_date: e.target.value })} />
            </label>
            <button className="btn-pri" onClick={addManuscript}>新增</button>
          </div>
        </div>
      )}

      <MessageBanner msg={msg} onClose={() => setMsg('')} />

      {/* 稿件列表 */}
      {manuscripts.length === 0 ? (
        <p className="empty">{view === 'active' ? '還沒有進行中的稿件' : '沒有封存的稿件'}</p>
      ) : sorted.map(m => {
        const steps = stepsByMs[m.id] ?? []
        const prog = computeProgress({ steps, isDone: m.is_done })
        const pct = prog.pct
        const isOpen = expanded.includes(m.id)
        return (
          <div key={m.id} className="panel">
            <div className="panel-head">
              {/* 無子項目:大項本身就是可勾的 checkbox(勾=100%、取消=0%,寫 is_done) */}
              {!prog.hasSteps && (
                <input type="checkbox" className="ms-done-check" checked={!!m.is_done}
                  onChange={() => toggleManuscriptDone(m)} title="標記整本完成" />
              )}
              <PriorityTag priority={m.priority} />
              <strong style={{ fontSize: 16 }} className={!prog.hasSteps && m.is_done ? 'done-text' : ''}>{m.title}</strong>
              <DeadlineBadge dueDate={m.due_date} pct={pct} />
              <span className="spacer" />
              <button className="btn-sm" onClick={() => toggleExpand(m.id)}>{isOpen ? '收合' : '展開子項目'}</button>
              <button className="btn-sm" onClick={() => setEditing({ ...m, due_date: m.due_date ?? '', target_date: m.target_date ?? '' })}>編輯</button>
              {view === 'active'
                ? <button className="btn-sm" onClick={() => setStatus(m.id, 'archived')}>封存</button>
                : <button className="btn-sm" onClick={() => setStatus(m.id, 'active')}>取回</button>}
              <button className="btn-sm btn-danger" onClick={() => deleteManuscript(m.id)}>刪除</button>
            </div>

            <div style={{ margin: '10px 0' }}><ProgressBar progress={prog} /></div>

            <div className="faint" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {m.due_date && <span>截止日：{m.due_date}</span>}
              {m.target_date && <span>目標日：{m.target_date}</span>}
            </div>

            {/* 子項目 */}
            {isOpen && (
              <div className="substeps" style={{ marginTop: 12, marginLeft: 0, paddingLeft: 0, borderLeft: 'none', borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
                {steps.length === 0 && <p className="empty">還沒有子項目</p>}
                {steps.map(s => (
                  <div key={s.id} className="step">
                    <input type="checkbox" checked={s.done} onChange={() => toggleStep(s)} />
                    <span className={s.done ? 'done-text' : ''} style={{ flex: 1 }}>{s.title}</span>
                    <button className="btn-sm btn-danger" onClick={() => deleteStep(s.id)}>刪</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input className="inp" style={{ flex: 1 }} placeholder="新增子項目…"
                    value={newStep[m.id] ?? ''}
                    onChange={e => setNewStep({ ...newStep, [m.id]: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') addStep(m.id) }} />
                  <button onClick={() => addStep(m.id)}>加入</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 編輯 modal */}
      {editing && (
        <div className="admin-modal-bg" onClick={() => setEditing(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <h3>編輯稿件</h3>
            <label>稿件名
              <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label>優先序
              <select value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value })}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </label>
            <label>截止日
              <input type="date" value={editing.due_date} onChange={e => setEditing({ ...editing, due_date: e.target.value })} />
            </label>
            <label>目標日
              <input type="date" value={editing.target_date} onChange={e => setEditing({ ...editing, target_date: e.target.value })} />
            </label>
            <div className="modal-acts">
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="btn-pri" onClick={saveEdit}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
