import { SESSION_KIND_LABEL } from '../sessionKind'
import { DemoBtn } from './common'
import { DEMO_GUARD_RECORDS, DEMO_GUARD_RECORD_STATS } from './demoData'

const KINDS = ['crunch', 'named']

// 導覽示範 · 看守紀錄頁(假資料)。
export default function DemoGuardRecords() {
  const CARD_STATS = {
    crunch: (st) => [{ lbl: '合照次數', val: st.photo }, { lbl: '互動次數', val: st.interact }],
    named: (st) => [{ lbl: '被指名次數', val: st.nominate }, { lbl: '拍立得次數', val: st.polaroid }],
  }
  return (
    <div className="records-page">
      <h3>看守紀錄</h3>
      <div className="rec-dash rec-dash-2">
        {KINDS.map(k => {
          const st = DEMO_GUARD_RECORD_STATS[k]
          return (
            <div key={k} className={`rec-typecard k-${k} on`}>
              <DemoBtn className="tc-head"><span className="tc-check on">✓</span><span className="tc-name">{SESSION_KIND_LABEL[k]}</span></DemoBtn>
              <div className="tc-body">
                <div className="tc-main"><span className="tc-num">{st.count}</span><span className="tc-lbl">看守次數</span></div>
                <div className="tc-subs">
                  {CARD_STATS[k](st).map((s, i) => (
                    <div key={i} className="tc-subrow"><span className="tsr-lbl">{s.lbl}</span><span className="tsr-val mono">{s.val}</span></div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {DEMO_GUARD_RECORDS.map(rec => (
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
            <div className="rec-row"><span className="rec-k">看守的犯人</span><span className="rec-v">{rec.guarded.length ? rec.guarded.join('、') : <span className="faint">本場無指派</span>}</span></div>
            {rec.kind === 'crunch' ? (<>
              <div className="rec-row"><span className="rec-k">本場合照</span><span className="rec-v">{rec.photoCount} 次</span></div>
              <div className="rec-row"><span className="rec-k">本場互動</span><span className="rec-v">{rec.interactCount} 次</span></div>
            </>) : (<>
              <div className="rec-row"><span className="rec-k">本場被指名</span><span className="rec-v">{rec.nominateCount} 次</span></div>
              <div className="rec-row"><span className="rec-k">本場拍立得</span><span className="rec-v">{rec.polaroidCount} 張</span></div>
            </>)}
          </div>
        </div>
      ))}
    </div>
  )
}
