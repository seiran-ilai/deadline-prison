import { useState } from 'react'
import { supabase } from './supabaseClient'
import AvatarInput from './AvatarInput'

// 編輯「自己」的個人資料:暱稱(game_name)+ 頭像(avatar_url)。
// RLS profiles_update_self 限制只能改自己那列(id = auth.uid())。
// props:userId、initial({ game_name, avatar_url })、onClose、onSaved(patch)
export default function ProfileEditModal({ userId, initial, onClose, onSaved }) {
  const [gameName, setGameName] = useState(initial?.game_name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(initial?.avatar_url ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    const patch = { game_name: gameName.trim() || null, avatar_url: avatarUrl.trim() || null }
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
    setSaving(false)
    if (error) { setErr('儲存失敗：' + error.message); return }
    onSaved(patch)
  }

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>編輯個人資料</h3>
        <label>暱稱
          <input value={gameName} onChange={e => setGameName(e.target.value)} placeholder="你的暱稱" />
        </label>
        <div className="field">
          <span className="field-lbl">頭像</span>
          <AvatarInput value={avatarUrl} onChange={setAvatarUrl} userId={userId} />
        </div>
        {err && <p className="warn">{err}</p>}
        <div className="modal-acts">
          <button onClick={onClose} disabled={saving}>取消</button>
          <button className="btn-pri" onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
        </div>
      </div>
    </div>
  )
}
