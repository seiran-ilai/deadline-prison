// 導覽示範共用元件/工具:靜態番茄鐘、直式身分卡、深拷貝、裝飾按鈕。
// 只給 src/demo/* 用;樣式沿用正式頁的 class,確保示範與真實畫面一致。

// 裝飾按鈕:外觀同真實按鈕但不可互動(pointer-events:none),
// 避免導覽中使用者點了「刪除/儲存」以為壞掉或誤以為動到真實資料。
export function DemoBtn({ className = 'btn-sm', children }) {
  return <button type="button" className={`${className} demo-btn`} tabIndex={-1} aria-hidden="true">{children}</button>
}

// 靜態番茄鐘(示範用寫死 24:12 · 第 1/4 輪;不掛真 SessionStatus)
export function DemoTimer() {
  return (
    <div className="ses-timer focus">
      <div className="st-phase">
        <span className="st-badge" style={{ background: 'rgba(245,197,24,.16)', color: 'var(--hazard)' }}>專注</span>
        <span className="st-round">第 1 / 4 輪</span>
      </div>
      <div className="st-clock">24:12</div>
      <div className="st-dots">{[1, 2, 3, 4].map(n => <i key={n} className={n === 1 ? 'cur' : ''} />)}</div>
    </div>
  )
}

// 直式身分卡(對照 ProfileCard variant="id" 的骨架)
export function DemoIdCard({ profile, label, watch }) {
  const name = profile.game_name
  const roleClass = profile.role === 'warden' ? 'warden' : profile.role === 'guard' ? 'guard' : 'member'
  const roleLabel = profile.role === 'guard' ? '獄卒' : profile.role === 'warden' ? '典獄長' : '囚犯'
  return (
    <div className={`idcard ${profile.role === 'member' ? 'me' : 'guardself'}`}>
      <div className="id-av">{name[0]}</div>
      <div className="id-lbl">{label}</div>
      <div className="id-no">{profile.inmate_no != null ? `No.${String(profile.inmate_no).padStart(4, '0')}` : ' '}</div>
      <div className="id-nm">{name} <span className={`role-tag ${roleClass}`}>{roleLabel}</span></div>
      {watch && <div className="id-watch">{watch}</div>}
      <div className="id-spacer" aria-hidden="true">&nbsp;</div>
    </div>
  )
}

// 深拷貝含 steps 的清單(demo 本地勾選狀態用,避免動到共用假資料)
export const cloneWithSteps = (list) => list.map(x => ({ ...x, steps: x.steps.map(s => ({ ...s })) }))
