import { useEffect, useRef, useState } from 'react'

// 番茄鐘階段切換鈴聲(服刑 ↔ 放風 / 長休息 / 結束)。
//
// 瀏覽器禁止「沒有使用者手勢」就自動播放聲音,所以一定要先點一次按鈕(arm)解鎖;
// arm 當下會試播一次(順便讓使用者確認音量),之後該畫面整場就能自動響。
//
// 用法:
//   const bellKey = (開始且未結束) ? `${phase}-${round}` : null   // 階段或輪次一變 = 切換
//   const { armed, arm } = useTransitionBell(bellKey)
//   // 畫面放一顆 <button onClick={arm}> 啟用鈴聲;armed 為 true 後不必再點。
// bellKey 變動且非首次時自動播放;傳 null(尚未開始/已結束)時不會響。
export function useTransitionBell(bellKey, src = '/bell.mp3') {
  const [armed, setArmed] = useState(false)
  const audioRef = useRef(null)
  const prevKey = useRef(undefined)

  useEffect(() => {
    const a = new Audio(src)
    a.preload = 'auto'
    audioRef.current = a
    return () => { audioRef.current = null }
  }, [src])

  // 解鎖 + 試播:必須在使用者手勢(點擊)內呼叫
  async function arm() {
    const a = audioRef.current
    if (!a) return
    try {
      a.currentTime = 0
      await a.play()
      setArmed(true)
    } catch { /* 解鎖失敗(極少),使用者可再點一次 */ }
  }

  // 偵測切換:armed 後,bellKey 變動就播放。
  // 尚未 armed 時只同步 prevKey(不播),確保 arm 後是從「下一次切換」才開始響。
  useEffect(() => {
    if (!armed) { prevKey.current = bellKey; return }
    const a = audioRef.current
    if (bellKey != null && prevKey.current != null && prevKey.current !== bellKey && a) {
      try { a.currentTime = 0; a.play() } catch { /* 播放失敗忽略 */ }
    }
    prevKey.current = bellKey
  }, [bellKey, armed])

  return { armed, arm }
}
