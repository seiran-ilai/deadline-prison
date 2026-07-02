import { useState } from 'react'
import { ProgressBar } from '../ManuscriptManager'
import { computeProgress } from '../progress'
import { PRESENCE_STYLE } from '../GuardWork'
import { SESSION_KIND_LABEL } from '../sessionKind'
import { DemoBtn, DemoTimer } from './common'
import {
  DEMO_SESSION_MEMOS, DEMO_MY_INMATES, DEMO_WARD_BOOKINGS, DEMO_OTHER_INMATES, DEMO_WORKLIST,
  DEMO_SERVE_TARGETS, DEMO_INCOME_CRUNCH, DEMO_INCOME_NAMED, DEMO_SESSION_GUARDS,
} from './demoData'

// 本場 MEMO / 確認項(服刑中逐項勾選;示範用本地 cosmetic 狀態)
function DemoMemoPanel() {
  const [checked, setChecked] = useState(() => new Set(DEMO_SESSION_MEMOS.filter(m => m.done).map(m => m.id)))
  const toggle = (id) => setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <div className="card-panel sg-section">
      <div className="head"><h2>本場 MEMO / 確認項</h2><span className="spacer" /><DemoBtn>＋ 新增</DemoBtn></div>
      <div className="body">
        <div className="memo-list">
          {DEMO_SESSION_MEMOS.map(m => {
            const on = checked.has(m.id)
            return (
              <label key={m.id} className="memo-check">
                <input type="checkbox" checked={on} onChange={() => toggle(m.id)} />
                <div className="memo-check-body">
                  <div className="memo-check-meta">
                    <span className={`role-tag ${m.scope === 'every' ? 'warden' : 'guard'}`}>{m.scope === 'every' ? '每場' : '指定場'}</span>
                    {m.target && <span className="faint">對象：{m.target}</span>}
                  </div>
                  <span className={on ? 'done-text' : ''}>{m.content}</span>
                </div>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function IncomeCard({ income }) {
  return (
    <div className="work-income">
      <div className="wi-title">即時收入（估算）</div>
      {income.segments.map((seg, i) => (
        <div key={i} className="wi-row"><span>{seg.title}{seg.note ? `（${seg.note}）` : ''}</span><b>{seg.amount}</b></div>
      ))}
      <div className="wi-row sub"><span>個人薪資</span><b>{income.direct}</b></div>
      <div className="wi-row"><span>獎金薪資（均分獎金池）</span><b>{income.pool}</b></div>
      <div className="wi-row total"><span>個人薪資 ＋ 獎金薪資 = 總金額</span><b>{income.final}</b></div>
    </div>
  )
}

// 目標稿件列(可展開子項目;示範用本地狀態,受控勾選:收合再展開不會還原,進度條同步)
function GoalList({ goals }) {
  const [expanded, setExpanded] = useState([])
  const [done, setDone] = useState({})   // step.id → 勾選覆寫(未覆寫則用假資料預設)
  const toggle = (id) => setExpanded(e => e.includes(id) ? e.filter(x => x !== id) : [...e, id])
  const isDone = (s) => done[s.id] ?? s.done
  return goals.map(g => {
    const prog = computeProgress({ steps: g.steps.map(s => ({ ...s, done: isDone(s) })), isDone: g.is_done })
    const isOpen = expanded.includes(g.id)
    return (
      <div key={g.id} className="gw-goal">
        <div className="gw-goal-hd">
          <span className="gw-goal-nm">{g.title}</span>
          <div className="gw-goal-bar"><ProgressBar progress={prog} /></div>
          <button className="btn-sm" onClick={() => toggle(g.id)}>{isOpen ? '收合' : '展開'}</button>
        </div>
        {isOpen && (
          <div className="substeps">
            {g.steps.length === 0 ? <p className="empty">這本稿還沒有子項目</p>
              : g.steps.map(s => (
                <div key={s.id} className="step">
                  <input type="checkbox" checked={isDone(s)} onChange={() => setDone(d => ({ ...d, [s.id]: !isDone(s) }))} />
                  <span className={isDone(s) ? 'done-text' : ''}>{s.title}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    )
  })
}

function Chip({ status }) {
  if (!status) return null
  const ps = PRESENCE_STYLE[status] ?? PRESENCE_STYLE['尚未挑稿']
  return <span className="chip" style={{ background: ps.bg, color: ps.color }}>{status}</span>
}

// 導覽示範 · 獄卒作業頁(假資料)。kind='crunch'/'named' 呈現兩種不同介面。
export default function DemoGuardWork({ kind = 'crunch' }) {
  const named = kind === 'named'
  const [work, setWork] = useState(() => DEMO_WORKLIST.map(w => ({ ...w, done: {} })))
  const toggleWork = (wid, f) => setWork(ws => ws.map(w => w.id === wid ? { ...w, done: { ...w.done, [f]: !w.done[f] } } : w))
  const [serve, setServe] = useState(() => DEMO_SERVE_TARGETS.map(t => ({ ...t, done: {} })))
  const toggleServe = (ti, key) => setServe(ss => ss.map((t, i) => i === ti ? { ...t, done: { ...t.done, [key]: !t.done[key] } } : t))

  return (
    <div>
      {/* 場次切換(示範:反白目前 kind;裝飾按鈕,實際切換由導覽步驟驅動) */}
      <div className="gw-switch" data-tour="gw-switch">
        <span className="gw-switch-lbl">切換場次</span>
        <DemoBtn className={`gw-switch-btn k-crunch${!named ? ' on' : ''}`}>
          <span className="gw-kind">{SESSION_KIND_LABEL.crunch}</span><span className="gw-title">週末衝刺場</span>
        </DemoBtn>
        <DemoBtn className={`gw-switch-btn k-named${named ? ' on' : ''}`}>
          <span className="gw-kind">{SESSION_KIND_LABEL.named}</span><span className="gw-title">指名互動夜</span>
        </DemoBtn>
      </div>

      {/* 上排:我(獄卒) + 番茄鐘/本場 MEMO */}
      <div className="ses-top guard">
        <div className="idcard guardself">
          <div className="id-av">示</div>
          <div className="id-lbl">我 · 看守中</div>
          <div className="id-no">{' '}</div>
          <div className="id-nm">示範獄卒 <span className="role-tag guard">獄卒</span></div>
          <div className="id-watch">👁 專屬看守 2 人 · 本場共 4 人</div>
          <div className="id-spacer" aria-hidden="true">&nbsp;</div>
        </div>
        {named ? <DemoMemoPanel /> : <DemoTimer />}
      </div>

      {named ? (
        /* 指名互動:我的服務對象 */
        <div className="card-panel" data-tour="gw-serve">
          <div className="head"><h2>我的服務對象</h2><span className="count">指名 {serve.length} 位</span></div>
          <div className="body">
            <div className="serve-list">
              {serve.map((t, ti) => (
                <div key={ti} className="serve-card">
                  <div className="serve-head">
                    <span className="serve-nm">{t.name}</span>
                    <span className="serve-no mono">No.{String(t.no).padStart(4, '0')}</span>
                    <span className="spacer" />
                    <Chip status={t.status} />
                  </div>
                  <div className="serve-row"><span className="serve-k">預約時段</span>
                    <span className="serve-v">{t.slots.length ? t.slots.join('、') : <span className="faint">—</span>}</span></div>
                  <div className="serve-row goals"><span className="serve-k">購買項目</span>
                    <div className="serve-buys">
                      {t.buys.map((b, bi) => (
                        <div key={bi} className="serve-buy">
                          <span className="sb-name">{b.name}</span>
                          {b.chks.map(c => {
                            const key = `${bi}-${c.f}`
                            return (
                              <label key={c.f} className={`sb-chk${t.done[key] ? ' on' : ''}`}>
                                <input type="checkbox" checked={!!t.done[key]} onChange={() => toggleServe(ti, key)} />{c.lbl}完成
                              </label>
                            )
                          })}
                        </div>
                      ))}
                    </div></div>
                  <div className="serve-row goals"><span className="serve-k">目標稿件</span>
                    <div className="serve-goals">
                      {t.goals.length === 0 ? <span className="faint">本場還沒挑目標</span> : <GoalList goals={t.goals} />}
                    </div></div>
                </div>
              ))}
            </div>
            <IncomeCard income={DEMO_INCOME_NAMED} />
          </div>
        </div>
      ) : (
        /* 集體趕稿:MEMO + 本場囚犯 */
        <div className="ses-mid">
          <DemoMemoPanel />
          <div className="card-panel" data-tour="gw-inmates">
            <div className="head"><h2>本場囚犯</h2><span className="count">{DEMO_MY_INMATES.length + DEMO_OTHER_INMATES.length} 人</span></div>
            <div className="body">
              <div className="subgroup mine first">我看守的犯人 ({DEMO_MY_INMATES.length + DEMO_WARD_BOOKINGS.length})<span className="ln" /></div>
              {DEMO_MY_INMATES.map(c => (
                <div key={c.id} className="inmate mine" style={{ alignItems: 'flex-start' }}>
                  <div className="in-av">{c.name[0]}</div>
                  <div>
                    <div className="in-nm">{c.name}<span className="tag-mine">指派給我</span></div>
                    <div className="in-no">No.{String(c.no).padStart(4, '0')}</div>
                  </div>
                  <span className="spacer" />
                  <Chip status={c.status} />
                  <div className="in-works">
                    {c.goals.length === 0 ? <p className="empty">本場還沒挑目標</p> : <GoalList goals={c.goals} />}
                  </div>
                </div>
              ))}
              {DEMO_WARD_BOOKINGS.map(w => (
                <div key={w.booking_id} className="inmate mine" style={{ alignItems: 'center' }}>
                  <div className="in-av">{w.game_name[0]}</div>
                  <div>
                    <div className="in-nm">{w.game_name}<span className="tag-mine">指派給我</span></div>
                    <div className="in-no faint">走查 / 臨時報名</div>
                  </div>
                </div>
              ))}
              <div className="subgroup">本場其他囚犯 ({DEMO_OTHER_INMATES.length})<span className="ln" /></div>
              {DEMO_OTHER_INMATES.map(c => (
                <div key={c.id} className="inmate">
                  <div className="in-av">{c.name[0]}</div>
                  <div>
                    <div className="in-nm">{c.name}</div>
                    <div className="in-no">No.{String(c.no).padStart(4, '0')}</div>
                  </div>
                  <span className="spacer" />
                  <Chip status={c.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 集體趕稿:本場工作 + 即時收入 */}
      {!named && (
        <div className="card-panel" data-tour="gw-worklist">
          <div className="head"><h2>本場工作</h2><span className="count">{work.length} 項</span>
            <span className="muted" style={{ fontSize: 12 }}>指派給你的被指名 / 拍立得 / 互動探監</span>
          </div>
          <div className="body">
            <div className="wk-grid">
              {work.map(it => (
                <div key={it.id} className="wk-item">
                  <div className="wk-item-hd">
                    <span className={`wk-type ${it.tcls}`}>{it.tlabel}</span>
                    <span className="wk-who">{it.who}</span>
                    <span className="spacer" />
                    <span className="wk-amt mono">{it.amount} 萬</span>
                  </div>
                  {it.detail && <div className="wk-detail">{it.detail}</div>}
                  <div className="wk-chks">
                    {it.chks.map(c => (
                      <label key={c.f} className={`sb-chk${it.done[c.f] ? ' on' : ''}`}>
                        <input type="checkbox" checked={!!it.done[c.f]} onChange={() => toggleWork(it.id, c.f)} />{c.lbl}完成
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <IncomeCard income={DEMO_INCOME_CRUNCH} />
          </div>
        </div>
      )}

      {/* 本場獄卒 */}
      <div className="card-panel" data-tour="gw-guards">
        <div className="head"><h2>本場獄卒</h2><span className="count">{DEMO_SESSION_GUARDS.length} 位</span></div>
        <div className="body">
          <div className="guard-grid">
            {DEMO_SESSION_GUARDS.map(g => (
              <div key={g.id} className="guard-cell">
                <div className="g-av">{g.name[0]}</div>
                <div className="g-nm">{g.name}{g.me ? ' · 你' : ''}</div>
                <span className="role-tag guard">{g.role === 'warden' ? '典獄長' : '獄卒'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
