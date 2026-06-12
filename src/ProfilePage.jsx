import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import AvatarInput from './AvatarInput'

// 「個人資料」分頁:本人編輯自己那列 profiles(頭貼 / 暱稱 / 自我介紹 /(犯人才有)公開到犯人牆)。
// RLS profiles_update_self 限制只能改自己(id = auth.uid());role 不在此頁變更。
// 角色差異:
//   犯人(member)— 自介為「犯人牆」用,並可開關 on_wall(公開到犯人牆)。
//   獄方(guard/warden)— 自介為「官網人員牆」用,獄方一律公開,不顯示 on_wall 開關。
// props:userId、role、onSaved(patch)— 讓上層(App topbar 暱稱顯示)同步更新
export default function ProfilePage({ userId, role, onSaved }) {
  const isStaff = role === 'guard' || role === 'warden'
  const [loading, setLoading] = useState(true)
  const [gameName, setGameName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [bio, setBio] = useState('')
  const [onWall, setOnWall] = useState(false)
  const [onLeaderboard, setOnLeaderboard] = useState(true)  // 排行榜顯示名字(預設公開)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  // 修改密碼:僅 email 通道用戶顯示(Discord 登入者沒有密碼可改)
  const [isEmailUser, setIsEmailUser] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwErr, setPwErr] = useState('')
  const [pwSaved, setPwSaved] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setIsEmailUser(data.session?.user?.app_metadata?.provider === 'email')
    })
    return () => { alive = false }
  }, [])

  async function changePassword() {
    setPwErr(''); setPwSaved(false)
    if (pw1.length < 8) { setPwErr('密碼至少需 8 碼'); return }
    if (pw1 !== pw2) { setPwErr('兩次輸入的密碼不一致'); return }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pw1 })
    setPwSaving(false)
    if (error) {
      setPwErr(error.message.includes('different from the old')
        ? '新密碼不可與舊密碼相同' : '修改失敗，請稍後再試')
      return
    }
    setPwSaved(true); setPw1(''); setPw2('')
  }

  useEffect(() => {
    let alive = true
    supabase.from('profiles').select('game_name, avatar_url, bio, on_wall, on_leaderboard').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        if (data) {
          setGameName(data.game_name ?? '')
          setAvatarUrl(data.avatar_url ?? '')
          setBio(data.bio ?? '')
          setOnWall(!!data.on_wall)
          setOnLeaderboard(data.on_leaderboard !== false)   // null/undefined 視為公開
        }
        setLoading(false)
      })
    return () => { alive = false }
  }, [userId])

  async function save() {
    setSaving(true); setErr(''); setSaved(false)
    // 自介空字串存 null(DB 仍存 null,fallback 只在前端顯示)
    const patch = {
      game_name: gameName.trim() || null,
      avatar_url: avatarUrl.trim() || null,
      bio: bio.trim() || null,
    }
    if (role === 'member') { patch.on_wall = onWall; patch.on_leaderboard = onLeaderboard }   // 獄方一律公開,不寫這兩欄
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
    setSaving(false)
    if (error) { setErr('儲存失敗：' + error.message); return }
    setSaved(true)
    onSaved?.(patch)
  }

  if (loading) return <p className="empty">讀取個人資料中…</p>

  return (
    <div className="profile-page">
      <h3>個人資料</h3>
      <div className="card-panel">
        <div className="pf-form">
          <div className="field">
            <span className="field-lbl">頭像</span>
            <AvatarInput value={avatarUrl} onChange={setAvatarUrl} userId={userId} />
          </div>
          <label className="pf-label">暱稱
            <input value={gameName} onChange={e => { setGameName(e.target.value); setSaved(false) }} placeholder="你的暱稱" />
          </label>
          <label className="pf-label">
            <span className="pf-label-row">
              {isStaff ? '個人介紹（官網人員牆用）' : '自我介紹（犯人牆用）'}
              <span className="pf-count">{bio.length} / 100</span>
            </span>
            <textarea rows={4} maxLength={100} value={bio} onChange={e => { setBio(e.target.value); setSaved(false) }}
              placeholder={isStaff ? '寫一句介紹，顯示在官網人員牆上' : '寫一句自我介紹，公開時顯示在犯人牆上'} />
          </label>
          {role === 'member' && (
            <>
              <label className="pf-toggle">
                <input type="checkbox" checked={onWall} onChange={e => { setOnWall(e.target.checked); setSaved(false) }} />
                公開到犯人牆
              </label>
              <label className="pf-toggle">
                <input type="checkbox" checked={onLeaderboard} onChange={e => { setOnLeaderboard(e.target.checked); setSaved(false) }} />
                排行榜顯示我的名字
              </label>
              <p className="pf-hint">關閉時，你的次數仍會計入排行榜，但名字顯示為〔機密犯人〕。</p>
            </>
          )}
          {err && <p className="warn">{err}</p>}
          <div className="pf-acts">
            <button className="btn-pri" onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            {saved && <span className="pf-saved">已儲存</span>}
          </div>
        </div>
      </div>

      {/* 修改密碼:僅信箱註冊用戶(已登入狀態直接 updateUser,不需舊密碼) */}
      {isEmailUser && (
        <div className="card-panel" style={{ marginTop: 16 }}>
          <div className="pf-form">
            <h4 style={{ margin: 0 }}>修改密碼</h4>
            <label className="pf-label">新密碼
              <input type="password" autoComplete="new-password" value={pw1}
                placeholder="至少 8 碼" onChange={e => { setPw1(e.target.value); setPwSaved(false) }} />
            </label>
            <label className="pf-label">再次輸入新密碼
              <input type="password" autoComplete="new-password" value={pw2}
                onChange={e => { setPw2(e.target.value); setPwSaved(false) }} />
            </label>
            {pwErr && <p className="warn">{pwErr}</p>}
            <div className="pf-acts">
              <button className="btn-pri" onClick={changePassword} disabled={pwSaving}>
                {pwSaving ? '修改中…' : '修改密碼'}
              </button>
              {pwSaved && <span className="pf-saved">密碼已更新</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
