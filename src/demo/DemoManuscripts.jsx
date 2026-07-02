import { useState } from 'react'
import { ProgressBar, PRIORITY } from '../ManuscriptManager'
import { computeProgress } from '../progress'
import { DemoBtn, cloneWithSteps } from './common'
import { DEMO_MANUSCRIPTS } from './demoData'

// 導覽示範 · 我的稿件頁(假資料)。
export default function DemoManuscripts() {
  const [list, setList] = useState(cloneWithSteps(DEMO_MANUSCRIPTS))
  const [expanded, setExpanded] = useState(['ms1'])
  const toggleStep = (mid, sid) => setList(ms => ms.map(m => m.id !== mid ? m
    : { ...m, steps: m.steps.map(s => s.id === sid ? { ...s, done: !s.done } : s) }))
  const toggleDone = (mid) => setList(ms => ms.map(m => m.id === mid ? { ...m, is_done: !m.is_done } : m))
  const toggleExpand = (mid) => setExpanded(e => e.includes(mid) ? e.filter(x => x !== mid) : [...e, mid])

  return (
    <div className="ms-page">
      <p className="muted" style={{ marginBottom: 4 }}>📍 我的稿件 · 遊戲暱稱：示範犯人</p>
      <h3>稿件管理</h3>
      <div data-tour="ms-list">
        {list.map(m => {
          const prog = computeProgress({ steps: m.steps, isDone: m.is_done })
          const p = PRIORITY[m.priority] ?? PRIORITY[2]
          const isOpen = expanded.includes(m.id)
          return (
            <div key={m.id} className="panel">
              <div className="panel-head">
                {!prog.hasSteps && (
                  <input type="checkbox" className="ms-done-check" checked={!!m.is_done} onChange={() => toggleDone(m.id)} title="標記整本完成" />
                )}
                <span style={{ background: p.bg, color: '#fff', fontSize: 12, padding: '1px 8px', borderRadius: 10 }}>{p.label}</span>
                <strong style={{ fontSize: 16 }} className={!prog.hasSteps && m.is_done ? 'done-text' : ''}>{m.title}</strong>
                <span className="spacer" />
                <button className="btn-sm" onClick={() => toggleExpand(m.id)}>{isOpen ? '收合' : '展開子項目'}</button>
                <DemoBtn>編輯</DemoBtn>
                <DemoBtn>封存</DemoBtn>
                <DemoBtn className="btn-sm btn-danger">刪除</DemoBtn>
              </div>
              <div style={{ margin: '10px 0' }}><ProgressBar progress={prog} /></div>
              {m.due_date && <div className="faint" style={{ display: 'flex', gap: 16 }}><span>截止日：{m.due_date}</span></div>}
              {isOpen && (
                <div className="substeps" style={{ marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>
                  {m.steps.length === 0 && <p className="empty">還沒有子項目</p>}
                  {m.steps.map(s => (
                    <div key={s.id} className="step">
                      <input type="checkbox" checked={s.done} onChange={() => toggleStep(m.id, s.id)} />
                      <span className={s.done ? 'done-text' : ''} style={{ flex: 1 }}>{s.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
