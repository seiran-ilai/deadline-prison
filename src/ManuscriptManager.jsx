import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

// 優先序設定:1高 2中 3低
const PRIORITY = {
  1: { label: '高', color: '#fff', bg: '#d9534f' },
  2: { label: '中', color: '#fff', bg: '#e08e0b' },
  3: { label: '低', color: '#fff', bg: '#888' },
}
// 隱私設定
const VISIBILITY = {
  public: { label: '公開', icon: '🌐' },
  staff: { label: '僅獄卒', icon: '👮' },
  private: { label: '私密', icon: '🔒' },
}

const blankForm = { title: '', priority: 2, due_date: '', target_date: '', visibility: 'public' }

function PriorityTag({ priority }) {
  const p = PRIORITY[priority] ?? PRIORITY[2]
  return (
    <span style={{ background: p.bg, color: p.color, fontSize: 12, padding: '1px 8px', borderRadius: 10 }}>
      {p.label}
    </span>
  )
}

export function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 10, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#2a7' : '#5a8fd0', transition: 'width .2s' }} />
      </div>
      <span style={{ fontSize: 12, color: '#666', minWidth: 64, textAlign: 'right' }}>
        {total ? `${done}/${total}（${pct}%）` : '尚無子項目'}
      </span>
    </div>
  )
}

export default function ManuscriptManager({ userId }) {
  const [view, setView] = useState('active')      // 'active' | 'archived'
  const [manuscripts, setManuscripts] = useState([])
  const [stepsByMs, setStepsByMs] = useState({})  // { manuscript_id: [step, ...] }
  const [expanded, setExpanded] = useState([])    // 展開中的稿件 id
  const [form, setForm] = useState(blankForm)     // 新增稿件表單
  const [newStep, setNewStep] = useState({})      // { manuscript_id: 子項目輸入字串 }
  const [editing, setEditing] = useState(null)    // 編輯中的稿件(modal 用)
  const [msg, setMsg] = useState('')

  async function load() {
    const { data: ms, error } = await supabase.from('manuscripts')
      .select('id, title, priority, due_date, target_date, status, visibility, created_at')
      .eq('member_id', userId).eq('status', view)
      .order('priority').order('created_at')
    if (error) { setMsg('載入失敗:' + error.message); return }
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
      visibility: form.visibility,
    })
    if (error) { setMsg('新增失敗:' + error.message); return }
    setForm(blankForm); setMsg('已新增稿件'); load()
  }

  async function saveEdit() {
    if (!editing.title.trim()) { setMsg('稿件名必填'); return }
    const { error } = await supabase.from('manuscripts').update({
      title: editing.title.trim(),
      priority: Number(editing.priority),
      due_date: editing.due_date || null,
      target_date: editing.target_date || null,
      visibility: editing.visibility,
    }).eq('id', editing.id)
    if (error) { setMsg('更新失敗:' + error.message); return }
    setEditing(null); setMsg('已更新'); load()
  }

  async function deleteManuscript(id) {
    if (!window.confirm('確定刪除這本稿件嗎?子項目也會一起刪除')) return
    // 先刪子項目,再刪稿件(避免外鍵殘留)
    await supabase.from('manuscript_steps').delete().eq('manuscript_id', id)
    const { error } = await supabase.from('manuscripts').delete().eq('id', id)
    if (error) { setMsg('刪除失敗:' + error.message); return }
    setMsg('已刪除稿件'); load()
  }

  async function setStatus(id, status) {
    const { error } = await supabase.from('manuscripts').update({ status }).eq('id', id)
    if (error) { setMsg('操作失敗:' + error.message); return }
    setMsg(status === 'archived' ? '已封存' : '已取回'); load()
  }

  // ── 子項目 CRUD ───────────────────────────
  async function toggleStep(step) {
    const { error } = await supabase.from('manuscript_steps')
      .update({ done: !step.done }).eq('id', step.id)
    if (error) { setMsg('更新失敗:' + error.message); return }
    load()
  }

  async function addStep(mid) {
    const title = (newStep[mid] ?? '').trim()
    if (!title) return
    const existing = stepsByMs[mid] ?? []
    const nextOrder = existing.length ? Math.max(...existing.map(s => s.sort_order ?? 0)) + 1 : 0
    const { error } = await supabase.from('manuscript_steps')
      .insert({ manuscript_id: mid, title, sort_order: nextOrder })
    if (error) { setMsg('新增子項目失敗:' + error.message); return }
    setNewStep({ ...newStep, [mid]: '' }); load()
  }

  async function deleteStep(stepId) {
    if (!window.confirm('確定刪除這個子項目嗎?')) return
    const { error } = await supabase.from('manuscript_steps').delete().eq('id', stepId)
    if (error) { setMsg('刪除失敗:' + error.message); return }
    load()
  }

  function toggleExpand(id) {
    setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // ── 樣式 ──────────────────────────────────
  const card = { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 12, background: '#fff', color: '#222' }
  const input = { padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222', colorScheme: 'light' }
  const btn = { padding: '6px 12px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }

  return (
    <div style={{ color: '#222' }}>
      {/* 檢視切換 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView('active')}
          style={{ ...btn, fontWeight: view === 'active' ? 700 : 400, background: view === 'active' ? '#eef4ff' : '#fafafa' }}>
          進行中
        </button>
        <button onClick={() => setView('archived')}
          style={{ ...btn, fontWeight: view === 'archived' ? 700 : 400, background: view === 'archived' ? '#eef4ff' : '#fafafa' }}>
          封存
        </button>
      </div>

      {/* 新增稿件(僅進行中檢視顯示) */}
      {view === 'active' && (
        <div style={{ ...card, background: '#fbfbfb' }}>
          <strong>新增稿件</strong>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <input style={{ ...input, flex: '1 1 180px' }} placeholder="稿件名(必填)"
              value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <label>優先序
              <select style={{ ...input, marginLeft: 4 }} value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </label>
            <label>隱私
              <select style={{ ...input, marginLeft: 4 }} value={form.visibility}
                onChange={e => setForm({ ...form, visibility: e.target.value })}>
                <option value="public">公開</option><option value="staff">僅獄卒</option><option value="private">私密</option>
              </select>
            </label>
            <label>截止日
              <input type="date" style={{ ...input, marginLeft: 4 }} value={form.due_date}
                onChange={e => setForm({ ...form, due_date: e.target.value })} />
            </label>
            <label>目標日
              <input type="date" style={{ ...input, marginLeft: 4 }} value={form.target_date}
                onChange={e => setForm({ ...form, target_date: e.target.value })} />
            </label>
            <button style={{ ...btn, background: '#eef4ff' }} onClick={addManuscript}>新增</button>
          </div>
        </div>
      )}

      {msg && <p style={{ color: '#2a7' }}>{msg}</p>}

      {/* 稿件列表 */}
      {manuscripts.length === 0 ? (
        <p style={{ color: '#888' }}>{view === 'active' ? '還沒有進行中的稿件' : '沒有封存的稿件'}</p>
      ) : manuscripts.map(m => {
        const steps = stepsByMs[m.id] ?? []
        const done = steps.filter(s => s.done).length
        const isOpen = expanded.includes(m.id)
        const vis = VISIBILITY[m.visibility] ?? VISIBILITY.public
        return (
          <div key={m.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <PriorityTag priority={m.priority} />
              <strong style={{ fontSize: 16 }}>{m.title}</strong>
              <span title={vis.label}>{vis.icon}</span>
              <span style={{ flex: 1 }} />
              <button style={btn} onClick={() => toggleExpand(m.id)}>{isOpen ? '收合' : '展開子項目'}</button>
              <button style={btn} onClick={() => setEditing({ ...m, due_date: m.due_date ?? '', target_date: m.target_date ?? '' })}>編輯</button>
              {view === 'active'
                ? <button style={btn} onClick={() => setStatus(m.id, 'archived')}>封存</button>
                : <button style={btn} onClick={() => setStatus(m.id, 'active')}>取回</button>}
              <button style={{ ...btn, color: '#c00' }} onClick={() => deleteManuscript(m.id)}>刪除</button>
            </div>

            <div style={{ margin: '10px 0' }}><ProgressBar done={done} total={steps.length} /></div>

            <div style={{ fontSize: 13, color: '#777', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {m.due_date && <span>截止日:{m.due_date}</span>}
              {m.target_date && <span>目標日:{m.target_date}</span>}
            </div>

            {/* 子項目 */}
            {isOpen && (
              <div style={{ marginTop: 12, borderTop: '1px dashed #ddd', paddingTop: 12 }}>
                {steps.length === 0 && <p style={{ color: '#999', margin: '0 0 8px' }}>還沒有子項目</p>}
                {steps.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input type="checkbox" checked={s.done} onChange={() => toggleStep(s)} />
                    <span style={{ flex: 1, textDecoration: s.done ? 'line-through' : 'none', color: s.done ? '#999' : '#222' }}>
                      {s.title}
                    </span>
                    <button style={{ ...btn, padding: '2px 8px', color: '#c00' }} onClick={() => deleteStep(s.id)}>刪</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input style={{ ...input, flex: 1 }} placeholder="新增子項目…"
                    value={newStep[m.id] ?? ''}
                    onChange={e => setNewStep({ ...newStep, [m.id]: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') addStep(m.id) }} />
                  <button style={btn} onClick={() => addStep(m.id)}>加入</button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 編輯 modal */}
      {editing && (
        <div onClick={() => setEditing(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', color: '#222', borderRadius: 8, padding: 24, width: 360, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <strong style={{ fontSize: 16 }}>編輯稿件</strong>
            <label>稿件名
              <input style={{ ...input, width: '100%', boxSizing: 'border-box' }} value={editing.title}
                onChange={e => setEditing({ ...editing, title: e.target.value })} />
            </label>
            <label>優先序
              <select style={{ ...input, width: '100%' }} value={editing.priority}
                onChange={e => setEditing({ ...editing, priority: e.target.value })}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </label>
            <label>隱私
              <select style={{ ...input, width: '100%' }} value={editing.visibility}
                onChange={e => setEditing({ ...editing, visibility: e.target.value })}>
                <option value="public">公開</option><option value="staff">僅獄卒</option><option value="private">私密</option>
              </select>
            </label>
            <label>截止日
              <input type="date" style={{ ...input, width: '100%' }} value={editing.due_date}
                onChange={e => setEditing({ ...editing, due_date: e.target.value })} />
            </label>
            <label>目標日
              <input type="date" style={{ ...input, width: '100%' }} value={editing.target_date}
                onChange={e => setEditing({ ...editing, target_date: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button style={btn} onClick={() => setEditing(null)}>取消</button>
              <button style={{ ...btn, background: '#eef4ff' }} onClick={saveEdit}>儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
