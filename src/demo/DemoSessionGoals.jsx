import { useState } from 'react'
import { ProgressBar, PRIORITY } from '../ManuscriptManager'
import { computeProgress } from '../progress'
import PersonalPomodoro from '../PersonalPomodoro'
import { DemoBtn, DemoTimer, DemoIdCard, cloneWithSteps } from './common'
import {
  DEMO_INMATE, DEMO_GUARD_SELF, DEMO_GOALS, DEMO_NAMED_PURCHASE, DEMO_NOMINATED_GUARD,
  DEMO_VISITS, DEMO_SESSION_GUARDS,
} from './demoData'

// 導覽示範 · 犯人服刑頁(假資料)。三種場次情境介面不同:
//   crunch(集體趕稿)= 番茄鐘 + 專屬獄卒 + 本場廣播;
//   named(指名互動)= 無番茄鐘、無本場廣播;上排 我/指名獄卒/本場預約與購入,之後 本場獄卒 → 本場目標;
//   free(自由入場)= 無獄卒相關資訊,個人番茄鐘可自行啟用,完成稿件照樣記到服刑紀錄。
export default function DemoSessionGoals({ kind = 'crunch' }) {
  const [goals, setGoals] = useState(cloneWithSteps(DEMO_GOALS))
  const [expanded, setExpanded] = useState(['g1'])
  const named = kind === 'named'
  const free = kind === 'free'

  const toggleStep = (gid, sid) => setGoals(gs => gs.map(g => g.id !== gid ? g
    : { ...g, steps: g.steps.map(s => s.id === sid ? { ...s, done: !s.done } : s) }))
  const toggleDone = (gid) => setGoals(gs => gs.map(g => g.id === gid ? { ...g, is_done: !g.is_done } : g))
  const toggleExpand = (gid) => setExpanded(e => e.includes(gid) ? e.filter(x => x !== gid) : [...e, gid])

  // 指名互動:本場預約與購入(依獄卒分欄可左右滑動;底部彙總固定不動)
  const namedPurchasePanel = (
    <div className="card-panel sg-buypanel" data-tour="sg-booking">
      <div className="head"><h2>本場預約與購入</h2><span className="count">指名互動</span></div>
      <div className="body">
        <div className="sg-buy-scroll">
          {DEMO_NAMED_PURCHASE.groups.map(g => (
            <div key={g.guard} className="sg-buy-col">
              <div className="sg-buy-guard">🛡 {g.guard}</div>
              {g.lines.map((l, i) => (
                <div key={i} className="sg-buy-line">
                  <span className={`sb-tag ${l.tag === '預約' ? 'bk' : 'pos'}`}>{l.tag}</span>
                  <span className="sb-desc">{l.desc}</span>
                  <span className="sb-amt mono">{l.amt} 萬</span>
                </div>
              ))}
              <div className="sg-buy-sub"><span>小計</span><span className="mono">{g.subtotal} 萬</span></div>
            </div>
          ))}
        </div>
        <div className="sg-buy-summary">
          <div className="sg-buy-srow"><span>指名費用</span><span className="mono">{DEMO_NAMED_PURCHASE.nominate} 萬</span></div>
          <div className="sg-buy-srow"><span>拍立得費用</span><span className="mono">{DEMO_NAMED_PURCHASE.polaroid} 萬</span></div>
          <div className="sg-buy-srow total"><span>合計</span><span className="mono">{DEMO_NAMED_PURCHASE.total} 萬</span></div>
        </div>
      </div>
    </div>
  )

  // 本場獄卒(指名互動排在本場目標之前;集體趕稿照舊排最底)
  const guardsPanel = (
    <div className="card-panel sg-section" data-tour="sg-guards">
      <div className="head"><h2>本場獄卒</h2><span className="count">{DEMO_SESSION_GUARDS.length} 位</span></div>
      <div className="body">
        <div className="guard-grid">
          {DEMO_SESSION_GUARDS.map(g => (
            <div key={g.id} className="guard-cell">
              <div className="g-av">{g.name[0]}</div>
              <div className="g-nm">{g.name}</div>
              <span className="role-tag guard">{g.role === 'warden' ? '典獄長' : '獄卒'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="sg-page">
      {/* 上排:我 (+ 專屬/指名獄卒) + 第三欄(集體=番茄鐘;自由=個人番茄鐘;指名=本場預約與購入)。自由入場無獄卒相關資訊。 */}
      <div className={`ses-top prisoner${free ? ' free' : ''}`} data-tour="sg-top">
        <DemoIdCard profile={DEMO_INMATE} label="我 · 服刑中" />
        {!free && (named
          ? <DemoIdCard profile={DEMO_NOMINATED_GUARD} label="指名獄卒" watch="👁 本場為你服務" />
          : <DemoIdCard profile={DEMO_GUARD_SELF} label="專屬獄卒" watch="👁 正在看著你服刑" />)}
        {free ? (
          <PersonalPomodoro title="本場：自由趕稿日" />
        ) : named ? (
          namedPurchasePanel
        ) : (
          <DemoTimer />
        )}
      </div>

      {/* 指名互動:本場獄卒排在本場目標之前 */}
      {named && guardsPanel}

      {/* 本場目標 */}
      <div className="card-panel" data-tour="sg-goals">
        <div className="head"><h2>本場目標</h2><span className="count">{goals.length} 項</span></div>
        <div className="body">
          {goals.map(g => {
            const prog = computeProgress({ steps: g.steps, isDone: g.is_done })
            const p = PRIORITY[g.priority] ?? PRIORITY[2]
            const isOpen = expanded.includes(g.id)
            return (
              <div key={g.id} className="panel">
                <div className="panel-head">
                  {!prog.hasSteps && (
                    <input type="checkbox" className="ms-done-check" checked={!!g.is_done} onChange={() => toggleDone(g.id)} title="標記整本完成" />
                  )}
                  <span className="chip" style={{ background: p.bg }}>{p.label}</span>
                  <strong className={!prog.hasSteps && g.is_done ? 'done-text' : ''}>{g.title}</strong>
                  <span className="spacer" />
                  {prog.hasSteps && <button className="btn-sm" onClick={() => toggleExpand(g.id)}>{isOpen ? '收合' : '展開子項目'}</button>}
                  <DemoBtn>取消</DemoBtn>
                </div>
                <div style={{ marginTop: 10 }}><ProgressBar progress={prog} /></div>
                {prog.hasSteps && isOpen && (
                  <div className="substeps" style={{ marginTop: 12 }}>
                    {g.steps.map(s => (
                      <div key={s.id} className="step">
                        <input type="checkbox" checked={s.done} onChange={() => toggleStep(g.id, s.id)} />
                        <span className={s.done ? 'done-text' : ''}>{s.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          <div className="toolbar" style={{ marginTop: 12 }}>
            <DemoBtn className="btn-pri">＋ 新增本場目標</DemoBtn>
          </div>
        </div>
      </div>

      {/* 本場廣播(探望)。僅集體趕稿顯示;指名互動無本場廣播、自由入場無獄卒相關資訊。 */}
      {!free && !named && (
      <div className="card-panel sg-section" data-tour="sg-visits">
        <div className="head"><h2>本場廣播</h2><span className="count">{DEMO_VISITS.length} 則</span></div>
        <div className="body">
          <div className="visit-list">
            {DEMO_VISITS.map(v => (
              <div key={v.id} className="visit-row">
                <div className="visit-text">
                  <span className="visit-who">💌 {v.visitor_name}</span>
                  <span className="visit-body">「{v.message}」</span>
                  {v.guard_name && <span className="visit-guard">🛡 指定獄卒：{v.guard_name}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* 本場獄卒(集體趕稿排最底;自由入場無獄卒,不顯示) */}
      {!free && !named && guardsPanel}
    </div>
  )
}
