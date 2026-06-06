import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { ROLE_LABEL } from './warden/constants'
import ProfileEditModal from './ProfileEditModal'

// 共用個人資料卡:左頭像、中暱稱+角色標籤、右「編輯」鈕。
// 自取當前登入者的 profile(沿用 profiles 既有欄位:game_name / avatar_url / role),
// 點「編輯」開 ProfileEditModal(只編輯自己),儲存後即時更新。
export default function ProfileCard({ userId }) {
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

  const name = profile.game_name || profile.display_name || '(未命名)'
  const roleClass = profile.role === 'warden' ? 'warden' : profile.role === 'guard' ? 'guard' : 'member'
  const init = name !== '(未命名)' ? name[0]
    : (profile.inmate_no != null ? String(profile.inmate_no).padStart(2, '0').slice(-2) : '?')

  return (
    <div className="card-panel profile-card">
      <div className="pc-av">
        {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span className="pc-init">{init}</span>}
      </div>
      <div className="pc-main">
        <div className="pc-name">{name}</div>
        <span className={`role-tag ${roleClass}`}>{ROLE_LABEL[profile.role] ?? profile.role}</span>
      </div>
      <button className="btn-sm pc-edit" onClick={() => setEditing(true)}>編輯</button>

      {editing && (
        <ProfileEditModal
          userId={userId}
          initial={profile}
          onClose={() => setEditing(false)}
          onSaved={(patch) => { setProfile(prev => ({ ...prev, ...patch })); setEditing(false) }}
        />
      )}
    </div>
  )
}
