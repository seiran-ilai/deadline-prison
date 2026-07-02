import { DemoBtn } from './common'
import { DEMO_PROFILE_FORM } from './demoData'

// 導覽示範 · 個人資料頁(假資料;不存檔)。
export default function DemoProfile() {
  return (
    <div className="profile-page">
      <h3>個人資料</h3>
      <div className="card-panel">
        <div className="pf-form">
          <div className="field">
            <span className="field-lbl">頭像</span>
            <div className="pc-av" style={{ width: 96, height: 96 }}><span className="pc-init">示</span></div>
          </div>
          <label className="pf-label">暱稱
            <input defaultValue={DEMO_PROFILE_FORM.game_name} placeholder="你的暱稱" />
          </label>
          <label className="pf-label">
            <span className="pf-label-row">自我介紹<span className="pf-count">{DEMO_PROFILE_FORM.bio.length} / 100</span></span>
            <textarea rows={4} maxLength={100} defaultValue={DEMO_PROFILE_FORM.bio} />
          </label>
          <div className="pf-acts">
            <DemoBtn className="btn-pri">儲存</DemoBtn>
          </div>
        </div>
      </div>
    </div>
  )
}
