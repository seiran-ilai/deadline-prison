import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import AvatarInput from './AvatarInput'
import { renameSelfAccount, zhAdminError } from './adminAccountApi'

// 「個人資料」分頁:本人編輯自己那列 profiles(頭貼 / 暱稱 / 自我介紹)。
// RLS profiles_update_self 限制只能改自己(id = auth.uid());role 不在此頁變更。
// 角色差異:
//   獄方(guard/warden)— 自介顯示於官網「監獄人員」;犯人自介目前不對外公開。
// 註:犯人牆/名人堂已下架,on_wall / on_leaderboard 欄位保留於 DB 但不再於此頁編輯。
// props:userId、role、onSaved(patch)— 讓上層(App topbar 暱稱顯示)同步更新
export default function ProfilePage({ userId, role, onSaved }) {
  const isStaff = role === 'guard' || role === 'warden'
  const [loading, setLoading] = useState(true)
  const [gameName, setGameName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  // 修改密碼:email 通道用戶 + 典獄長代開/核發的帳號顯示
  // (核發帳密的舊 Discord 用戶 provider 仍是 discord,改以 user_metadata.account_type 補判)
  const [isEmailUser, setIsEmailUser] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwErr, setPwErr] = useState('')
  const [pwSaved, setPwSaved] = useState(false)
  // 帳號設定:典獄長代開/核發的帳號可自改帳號名(走 /api/account-rename-self)
  const [accountName, setAccountName] = useState(null)   // 目前帳號名(假 email 的 local part);null = 非此類帳號
  const [newAccount, setNewAccount] = useState('')
  const [accSaving, setAccSaving] = useState(false)
  const [accErr, setAccErr] = useState('')
  const [accSaved, setAccSaved] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      if (!alive) return
      setIsEmailUser(
        u?.app_metadata?.provider === 'email' || u?.user_metadata?.account_type === 'warden_created'
      )
      if (u?.user_metadata?.account_type === 'warden_created') {
        setAccountName((u.email || '').split('@')[0] || null)
      }
    })
    return () => { alive = false }
  }, [])

  async function changeAccount() {
    setAccErr(''); setAccSaved(false)
    const acc = newAccount.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(acc)) { setAccErr('帳號名格式不符：僅允許小寫英文、數字與底線，3–20 字'); return }
    if (acc === accountName) { setAccErr('新帳號名與目前相同'); return }
    setAccSaving(true)
    const r = await renameSelfAccount(acc)
    setAccSaving(false)
    if (!r.ok) { setAccErr(zhAdminError(r.error)); return }
    setAccountName(r.account); setNewAccount(''); setAccSaved(true)
  }

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
    supabase.from('profiles').select('game_name, avatar_url, bio').eq('id', userId).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        if (data) {
          setGameName(data.game_name ?? '')
          setAvatarUrl(data.avatar_url ?? '')
          setBio(data.bio ?? '')
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
              {isStaff ? '個人介紹（官網人員牆用）' : '自我介紹'}
              <span className="pf-count">{bio.length} / 100</span>
            </span>
            <textarea rows={4} maxLength={100} value={bio} onChange={e => { setBio(e.target.value); setSaved(false) }}
              placeholder={isStaff ? '寫一句介紹，顯示在官網人員牆上' : '寫一句自我介紹'} />
          </label>
          {err && <p className="warn">{err}</p>}
          <div className="pf-acts">
            <button className="btn-pri" onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
            {saved && <span className="pf-saved">已儲存</span>}
          </div>
        </div>
      </div>

      {/* 帳號設定:典獄長代開/核發的帳號可自改帳號名(改名不影響編號/紀錄,下次登入用新帳號) */}
      {accountName && (
        <div className="card-panel" style={{ marginTop: 16 }}>
          <div className="pf-form">
            <h4 style={{ margin: 0 }}>帳號設定</h4>
            <label className="pf-label">目前帳號
              <input value={accountName} readOnly onFocus={e => e.target.select()} />
            </label>
            <label className="pf-label">新帳號名
              <input value={newAccount} maxLength={20} autoComplete="off"
                placeholder="a-z 0-9 _，3–20 字" onChange={e => { setNewAccount(e.target.value); setAccSaved(false) }} />
            </label>
            {accErr && <p className="warn">{accErr}</p>}
            <div className="pf-acts">
              <button className="btn-pri" onClick={changeAccount} disabled={accSaving || !newAccount.trim()}>
                {accSaving ? '更新中…' : '更新帳號名'}
              </button>
              {accSaved && <span className="pf-saved">已更新，下次登入請使用新帳號</span>}
            </div>
          </div>
        </div>
      )}

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
