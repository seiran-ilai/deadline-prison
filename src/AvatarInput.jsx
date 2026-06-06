import { useState } from 'react'
import { supabase } from './supabaseClient'

// 共用「頭像輸入」:可切「貼網址 / 上傳檔案」,兩種都即時預覽。
// 底層永遠是 URL —— 上傳只是把檔案丟到 avatars bucket、取得公開 URL 後回寫同一個欄位。
// props:value(目前 URL)、onChange(url)、userId(上傳檔名前綴,避免覆蓋衝突)
const MAX_BYTES = 5 * 1024 * 1024  // 5MB,需與 avatars bucket 的 file_size_limit 一致

export default function AvatarInput({ value, onChange, userId }) {
  const [mode, setMode] = useState('url')   // 'url' | 'upload'
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')
    if (!file.type.startsWith('image/')) { setErr('請選擇圖片檔(image/*)'); e.target.value = ''; return }
    if (file.size > MAX_BYTES) { setErr('檔案過大,上限 5MB'); e.target.value = ''; return }
    setUploading(true)
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    // 檔名 = 使用者 id + 時間戳,避免覆蓋衝突
    const path = `${userId ?? 'anon'}-${Date.now()}.${ext || 'png'}`
    const { error } = await supabase.storage.from('avatars')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type })
    if (error) {
      setUploading(false)
      setErr('上傳失敗:' + error.message + '(若是 Bucket not found,請先執行 avatars bucket 的 SQL)')
      e.target.value = ''
      return
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    setUploading(false)
    e.target.value = ''
    onChange(data.publicUrl)
  }

  return (
    <div className="avatar-input">
      <div className="ai-preview">
        {value ? <img src={value} alt="頭像預覽" /> : <span className="ai-empty">無頭像</span>}
      </div>
      <div className="ai-body">
        <div className="ai-tabs">
          <button type="button" className={mode === 'url' ? 'on' : ''} onClick={() => { setMode('url'); setErr('') }}>貼網址</button>
          <button type="button" className={mode === 'upload' ? 'on' : ''} onClick={() => { setMode('upload'); setErr('') }}>上傳檔案</button>
        </div>
        {mode === 'url' ? (
          <input type="text" className="inp" placeholder="https://… 圖片網址"
            value={value ?? ''} onChange={e => onChange(e.target.value)} />
        ) : (
          <label className="ai-file">
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} />
            <span>{uploading ? '上傳中…' : '📁 選擇圖片上傳'}</span>
          </label>
        )}
        {err && <p className="ai-err">{err}</p>}
        {value && <button type="button" className="ai-clear" onClick={() => onChange('')}>清除頭像</button>}
      </div>
    </div>
  )
}
