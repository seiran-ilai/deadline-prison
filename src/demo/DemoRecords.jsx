import { SESSION_KIND_LABEL } from '../sessionKind'
import { fmtRounds } from '../RecordsPage'
import { DemoBtn } from './common'
import { DEMO_RECORDS, DEMO_RECORD_STATS } from './demoData'

const KINDS = ['crunch', 'named', 'free']

// 導覽示範 · 服刑紀錄頁(假資料)。
export default function DemoRecords() {
  const CARD_STATS = {
    crunch: (st) => ({ main: st.count, subs: [{ lbl: '累計服刑（估算）', val: fmtRounds(st.rounds) }, { lbl: '收到探監 ▸', val: st.visits }] }),
    named: (st) => ({ main: st.count, subs: [] }),
    free: (st) => ({ main: st.count, subs: [] }),
  }
  return (
    <div className="records-page">
      <h3>服刑紀錄</h3>
      <div className="rec-dash">
        {KINDS.map(k => {
          const cs = CARD_STATS[k](DEMO_RECORD_STATS[k])
          return (
            <div key={k} className={`rec-typecard k-${k} on`}>
              <DemoBtn className="tc-head"><span className="tc-check on">✓</span><span className="tc-name">{SESSION_KIND_LABEL[k]}</span></DemoBtn>
              <div className="tc-body">
                <div className="tc-main"><span className="tc-num">{cs.main}</span><span className="tc-lbl">服刑次數</span></div>
                {cs.subs.length > 0 && (
                  <div className="tc-subs">
                    {cs.subs.map((s, i) => (
                      <div key={i} className="tc-subrow"><span className="tsr-lbl">{s.lbl}</span><span className="tsr-val mono">{s.val}</span></div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {DEMO_RECORDS.map(rec => {
        const goals = rec.goals.length ? rec.goals.join('、') : '無'
        return (
          <div key={rec.key} className="rec-card">
            <div className="rec-head">
              <span className={`kind-tag k-${rec.kind}`}>{SESSION_KIND_LABEL[rec.kind]}</span>
              <strong className="rec-title">{rec.title}</strong>
              <span className="rec-meta mono">{rec.date}</span>
              <span className="rec-meta">{rec.rounds} 輪</span>
              <span className="spacer" />
              <span className="tag tag-pill rec-status ended">已結束</span>
            </div>
            <div className="rec-body">
              {rec.kind === 'crunch' && (<>
                <div className="rec-row"><span className="rec-k">場次監督獄卒</span><span className="rec-v">{rec.guards.length ? rec.guards.join('、') : '無'}</span></div>
                <div className="rec-row"><span className="rec-k">已完成目標</span><span className="rec-v">{goals}</span></div>
                <div className="rec-row"><span className="rec-k">探監紀錄</span><span className="rec-v">
                  <span className="rec-visits">{rec.visits.map(v => (
                    <span key={v.id} className="rec-visit">💌 {v.visitor}：{v.message}{v.guard && <span className="faint">（🛡 {v.guard}）</span>}</span>
                  ))}</span></span></div>
              </>)}
              {rec.kind === 'named' && (<>
                <div className="rec-row"><span className="rec-k">品項與明細</span><span className="rec-v">
                  <span className="rec-items">
                    {rec.items.map((it, i) => (
                      <span key={i} className="rec-item"><span className="ri-name">{it.name}</span><span className="ri-guard">🛡 {it.guard}</span><span className="ri-amt mono">{it.amount} 萬</span></span>
                    ))}
                    <span className="rec-item rec-item-total"><span className="ri-name">合計</span><span className="ri-amt mono">{rec.items.reduce((s, it) => s + it.amount, 0)} 萬</span></span>
                  </span></span></div>
                <div className="rec-row"><span className="rec-k">已完成目標</span><span className="rec-v">{goals}</span></div>
              </>)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
