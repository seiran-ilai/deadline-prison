import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ROLE_LABEL } from './warden/constants'
import ProfileEditModal from './ProfileEditModal'

// 共用個人資料卡:自取當前登入者的 profile(沿用 profiles 既有欄位 game_name / avatar_url / role),
// 點「編輯」開 ProfileEditModal(只編輯自己),儲存後即時更新。
// variant:
//   'row'(預設)— 橫向精簡卡(典獄長後台 / 一般用)
//   'id'        — 服刑中畫面上排的直式身分卡(頭像在上、文字置中);可帶 label / footer
export default function ProfileCard({ userId, variant = 'row', label, footer, editable = true }) {
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    let alive = true
    if (!userId) return
    supabase.from('profiles')
      .select('id, inmate_no, game_name, display_name, avatar_url, role')
      .eq('id', userId).maybeSingle()
      .then(({ data }) => { if (alive) setProfile(data ?? null) })
    return () => { alive = false }
  }, [userId])

  if (!profile) return null

  const name = profile.game_name || profile.display_name || '（未命名）'
  const roleClass = profile.role === 'warden' ? 'warden' : profile.role === 'guard' ? 'guard' : 'member'
  const init = name !== '（未命名）' ? name[0]
    : (profile.inmate_no != null ? String(profile.inmate_no).padStart(2, '0').slice(-2) : '?')
  const roleLabel = ROLE_LABEL[profile.role] ?? profile.role

  const modal = editing && (
    <ProfileEditModal
      userId={userId}
      initial={profile}
      onClose={() => setEditing(false)}
      onSaved={(patch) => { setProfile(prev => ({ ...prev, ...patch })); setEditing(false) }}
    />
  )

  // 直式身分卡(服刑中上排)
  // 內部分層固定:頭像 / 標籤 / 編號 / 暱稱 為固定槽位,缺少的欄位以留白占位撐住,
  // 讓多張並排的身分卡頭像同基線、暱稱同高度(對齊用,不改資料)。
  if (variant === 'id') {
    const selfClass = profile.role === 'member' ? 'me' : 'guardself'
    const showNo = profile.role === 'member' && profile.inmate_no != null
    return (
      <div className={`idcard ${selfClass}`}>
        <div className="id-av">
          {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : init}
        </div>
        <div className="id-lbl">{label || ' '}</div>
        <div className="id-no">{showNo ? `No.${String(profile.inmate_no).padStart(4, '0')}` : ' '}</div>
        <div className="id-nm">{name} <span className={`role-tag ${roleClass}`}>{roleLabel}</span></div>
        {footer}
        {editable && <button className="btn-sm id-edit" onClick={() => setEditing(true)}>編輯</button>}
        {modal}
      </div>
    )
  }

  // 橫向精簡卡(預設)
  return (
    <div className="card-panel profile-card">
      <div className="pc-av">
        {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span className="pc-init">{init}</span>}
      </div>
      <div className="pc-main">
        <div className="pc-name">{name}</div>
        <span className={`role-tag ${roleClass}`}>{roleLabel}</span>
      </div>
      <button className="btn-sm pc-edit" onClick={() => setEditing(true)}>編輯</button>
      {modal}
    </div>
  )
}
