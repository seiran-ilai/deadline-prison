import { DemoBtn } from './common'
import { DEMO_MEMOS_EVERY, DEMO_MEMOS_SESSION, DEMO_SESSION_MEMO_TITLE } from './demoData'

// 導覽示範 · MEMO / 確認項頁(假資料)。分「每場」與「指定場」。
export default function DemoMemos() {
  const renderMemo = (m) => (
    <div key={m.id} className="memo-card">
      <div className="memo-card-top">
        <span className={`role-tag ${m.scope === 'every' ? 'warden' : 'guard'}`}>{m.scope === 'every' ? '每場' : '指定場'}</span>
        {m.target && <span className="faint memo-obj">對象：{m.target}</span>}
      </div>
      <div className="memo-content">{m.content}</div>
      <div className="memo-card-acts">
        <DemoBtn>編輯</DemoBtn>
        <DemoBtn className="btn-sm btn-danger">刪除</DemoBtn>
      </div>
    </div>
  )
  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>我的 MEMO / 確認項</h3>
        <DemoBtn className="btn-pri">＋ 新增 MEMO</DemoBtn>
      </div>
      <div data-tour="memo-list">
        <div className="group-lbl">每場 MEMO ({DEMO_MEMOS_EVERY.length})<span className="ln" /></div>
        <div className="memo-grid">{DEMO_MEMOS_EVERY.map(renderMemo)}</div>
        <div className="group-lbl">指定場：{DEMO_SESSION_MEMO_TITLE} ({DEMO_MEMOS_SESSION.length})<span className="ln" /></div>
        <div className="memo-grid">{DEMO_MEMOS_SESSION.map(renderMemo)}</div>
      </div>
    </div>
  )
}
