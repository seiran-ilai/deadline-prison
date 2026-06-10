import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

// 本場廣播(探監紀錄)唯讀面板:犯人服刑/獄卒作業共用。
// 只顯示「與自己相關、尚未完成」的廣播:犯人=探望我的(inmate_id=我),獄卒=指定由我執行的(guard_id=我);
// 全部廣播只在典獄長直播大螢幕輪播。典獄長標記完成(is_done)後即從這裡消失。
// 與頁面其他資料相同節奏:掛載即載入 + 每 10 秒輪詢。
export default function SessionVisits({ sessionId, userId, role = 'inmate' }) {
  const [visits, setVisits] = useState([])
  const [profById, setProfById] = useState({})

  useEffect(() => {
    if (!sessionId || !userId) return
    let alive = true
    async function load() {
      let q = supabase.from('visits')
        .select('id, inmate_id, guard_id, visitor_name, message, created_at')
        .eq('session_id', sessionId).eq('is_done', false)
      q = role === 'guard' ? q.eq('guard_id', userId) : q.eq('inmate_id', userId)
      const { data: vs } = await q.order('created_at', { ascending: false })
      if (!alive) return
      setVisits(vs ?? [])
      // 解析犯人/指定獄卒顯示名(分開查再合併,沿用全站慣例)
      const ids = [...new Set((vs ?? []).flatMap(v => [v.inmate_id, v.guard_id]).filter(Boolean))]
      if (!ids.length) { setProfById({}); return }
      const { data: profs } = await supabase.from('profiles')
        .select('id, inmate_no, game_name, display_name').in('id', ids)
      if (!alive) return
      const by = {}; for (const p of profs ?? []) by[p.id] = p
      setProfById(by)
    }
    load()
    const t = setInterval(load, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [sessionId, userId, role])

  const nameOf = (id) => {
    const p = profById[id]
    return p?.game_name ?? p?.display_name ?? '（未知）'
  }

  return (
    <div className="card-panel sg-section">
      <div className="head">
        <h2>本場廣播</h2>
        {visits.length > 0 && <span className="count">{visits.length} 筆</span>}
        <span className="muted" style={{ fontSize: 12 }}>
          {role === 'guard' ? '指定由你執行的探監廣播' : '探望你的廣播'}
        </span>
      </div>
      <div className="body">
        {visits.length === 0 ? (
          <p className="empty">{role === 'guard' ? '目前沒有指定你執行的廣播' : '目前沒有探望你的廣播'}</p>
        ) : (
          <div className="visit-list">
            {visits.map(v => {
              const ip = profById[v.inmate_id]
              const no = ip?.inmate_no != null ? String(ip.inmate_no).padStart(4, '0') : '----'
              return (
                <div key={v.id} className="visit-row">
                  <div className="visit-text">
                    <span className="visit-who">💌 {v.visitor_name} → No.{no} {nameOf(v.inmate_id)}</span>
                    <span className="visit-body">「{v.message}」</span>
                    {v.guard_id && <span className="visit-guard">🛡 指定獄卒：{nameOf(v.guard_id)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
