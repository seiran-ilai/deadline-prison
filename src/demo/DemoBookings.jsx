import { STATUS_PILL } from '../MyBookings'
import { DemoBtn } from './common'
import { DEMO_BOOKINGS } from './demoData'

// 導覽示範 · 已預約場次頁(假資料)。
export default function DemoBookings() {
  return (
    <div className="ms-page">
      <h3>已預約場次</h3>
      <div data-tour="booking-list">
        {DEMO_BOOKINGS.map(s => {
          const pill = STATUS_PILL[s.status] ?? STATUS_PILL.booking
          return (
            <div key={s.id} className="card-panel sg-section">
              <div className="head">
                <h2>{s.title}</h2>
                <span className="tag tag-pill" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
                <span className="muted">{s.date}</span>
                <span className="spacer" />
                <DemoBtn className="btn-sm btn-danger">取消預約</DemoBtn>
              </div>
              <div className="body">
                <div className="subgroup first">預排任務（{s.goals.length}）<span className="ln" /></div>
                {s.goals.length === 0 ? (
                  <p className="empty">還沒預排任務，點下方按鈕從你的稿件挑選</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {s.goals.map((g, i) => (
                      <span key={i} className="chip" style={{ background: 'rgba(245,197,24,.15)', color: 'var(--hazard)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {g}<span aria-hidden="true">✕</span>
                      </span>
                    ))}
                  </div>
                )}
                <DemoBtn>＋ 預排任務</DemoBtn>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
