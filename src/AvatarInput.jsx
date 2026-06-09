import { useState, useCallback } from 'react'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { supabase } from './supabaseClient'

// 共用「頭像輸入(裁切版)」:可切「貼網址 / 上傳檔案」。
//   貼網址 — 直接當 URL,不進裁切。
//   上傳檔案 — 只收 png/jpeg/jpg/webp(明確不收 gif);選圖後開裁切 modal(react-easy-crop,
//              固定 1:1、可縮放/拖曳),確認後以 canvas 輸出 512×512 的 jpeg 再上傳 avatars bucket。
// 底層永遠是 URL;onChange(url) 回拋公開網址。官網預約 / 後台 / 改自己資料三處共用同一支。
// props:value(目前 URL)、onChange(url)、userId(上傳檔名前綴,避免覆蓋衝突)
const MAX_BYTES = 5 * 1024 * 1024  // 5MB,需與 avatars bucket 的 file_size_limit 一致(針對原始選檔)
const ACCEPT = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']  // 不含 gif
const OUT_SIZE = 512  // 裁切輸出邊長(正方)

export default function AvatarInput({ value, onChange, userId }) {
  const [mode, setMode] = useState('url')   // 'url' | 'upload'
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  // 裁切 modal 狀態
  const [cropSrc, setCropSrc] = useState('')               // 待裁切原圖的 object URL('' = 關閉 modal)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setErr('')
    // 明確不接受 gif,其餘非允許型別也擋下
    if (file.type === 'image/gif') { setErr('不支援 GIF，請改用 PNG / JPG / WebP'); e.target.value = ''; return }
    if (!ACCEPT.includes(file.type)) { setErr('請選擇 PNG / JPG / WebP 圖片'); e.target.value = ''; return }
    if (file.size > MAX_BYTES) { setErr('檔案過大，上限 5MB'); e.target.value = ''; return }
    // 合法 → 開裁切 modal(重置裁切狀態)
    setCrop({ x: 0, y: 0 }); setZoom(1); setCroppedAreaPixels(null)
    setCropSrc(URL.createObjectURL(file))
    e.target.value = ''   // 清掉 input,讓同一檔可再次被選
  }

  const onCropComplete = useCallback((_area, areaPixels) => { setCroppedAreaPixels(areaPixels) }, [])

  function closeCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc('')
  }

  // 載入原圖 → 在 canvas 上把裁切區域(croppedAreaPixels)縮放到 512×512 → 輸出 jpeg blob
  function cropToBlob() {
    return new Promise((resolve, reject) => {
      const c = croppedAreaPixels
      if (!c) { reject(new Error('尚未取得裁切範圍')); return }
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = OUT_SIZE; canvas.height = OUT_SIZE
        const ctx = canvas.getContext('2d')
        // webp 來源亦輸出 jpeg 以利相容
        ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, OUT_SIZE, OUT_SIZE)
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('裁切輸出失敗')), 'image/jpeg', 0.9)
      }
      img.onerror = () => reject(new Error('讀取圖片失敗'))
      img.src = cropSrc
    })
  }

  async function confirmCrop() {
    if (!croppedAreaPixels) return
    setUploading(true); setErr('')
    try {
      const blob = await cropToBlob()
      // 檔名 = 使用者 id + 時間戳,固定 .jpg,避免覆蓋衝突
      const path = `${userId ?? 'anon'}-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('avatars')
        .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' })
      if (error) {
        setUploading(false)
        setErr('上傳失敗：' + error.message + '（若是 Bucket not found，請先執行 avatars bucket 的 SQL)')
        return
      }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      setUploading(false)
      onChange(data.publicUrl)   // 預覽顯示裁切後結果(沿用既有 value 預覽)
      closeCrop()
    } catch (ex) {
      setUploading(false)
      setErr(String(ex?.message || ex))
    }
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
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={uploading} />
            <span>{uploading ? '上傳中…' : '📁 選擇圖片上傳（將裁切為正方）'}</span>
          </label>
        )}
        {err && <p className="ai-err">{err}</p>}
        {value && <button type="button" className="ai-clear" onClick={() => onChange('')}>清除頭像</button>}
      </div>

      {/* 裁切 modal:scope 中性(inline style,不綁 .admin / .dp-site 色票),遮罩蓋滿可視區、置中卡片。
          react-easy-crop 內部樣式由其自帶 css 提供;此處僅排版外框與操作鈕。 */}
      {cropSrc && (
        <div
          onClick={e => { if (e.target === e.currentTarget && !uploading) closeCrop() }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.72)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(440px, 100%)', background: '#1d2127', color: '#e4e5e7',
              border: '1px solid rgba(255,255,255,.14)', borderRadius: 8, padding: 18,
              boxShadow: '0 12px 40px rgba(0,0,0,.5)', fontFamily: 'inherit',
            }}
          >
            <div style={{ position: 'relative', width: '100%', height: 300, background: '#000', borderRadius: 6, overflow: 'hidden' }}>
              <Cropper
                image={cropSrc} crop={crop} zoom={zoom} aspect={1}
                onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <span style={{ fontSize: 12, color: '#9298a2', whiteSpace: 'nowrap' }}>縮放</span>
              <input type="range" min={1} max={3} step={0.01} value={zoom}
                onChange={e => setZoom(Number(e.target.value))} style={{ flex: 1 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" onClick={closeCrop} disabled={uploading}
                style={{ padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  background: 'transparent', border: '1px solid rgba(255,255,255,.22)', color: '#cfd2d6' }}>
                取消
              </button>
              <button type="button" onClick={confirmCrop} disabled={uploading || !croppedAreaPixels}
                style={{ padding: '8px 18px', borderRadius: 6, cursor: uploading ? 'wait' : 'pointer', fontSize: 13,
                  fontWeight: 700, background: '#f5c518', border: 'none', color: '#0a0c0e',
                  opacity: (uploading || !croppedAreaPixels) ? .6 : 1 }}>
                {uploading ? '上傳中…' : '確認裁切'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
