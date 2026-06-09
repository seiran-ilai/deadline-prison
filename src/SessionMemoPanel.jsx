import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'
import GuardMemoModal from './GuardMemoModal'

// 服刑中「本場 MEMO · 確認項」面板(獄卒視角),取代犯人的本場目標位置。
// 本場適用 = 自己 scope='every' 全部 + scope='session' 且 session_id=本場。
// 完成狀態依「本場」讀 guard_memo_checks(memo_id, session_id=本場);勾=新增列、取消=刪除列。
export default function SessionMemoPanel({ userId, session }) {
  const sessionId = session?.id
  const [memos, setMemos] = useState([])
  const [checked, setChecked] = useState(new Set())    // 本場已完成的 memo_id
  const [prisonerName, setPrisonerName] = useState({}) // profile_id -> name
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    // 本場適用:every 全部 + 本場 session 的
    const { data: rows, error } = await supabase.from('guard_memos')
      .select('id, content, scope, session_id, target_prisoner_id')
      .eq('guard_id', userId)
      .or(`scope.eq.every,and(scope.eq.session,session_id.eq.${sessionId})`)
      .order('created_at', { ascending: false })
    if (error) { setMemos([]); setLoading(false); setMsg('讀取失敗：' + error.message); return }
    const list = rows ?? []
    setMemos(list)
    // 本場完成狀態
    const ids = list.map(m => m.id)
    if (ids.length) {
      const { data: cks } = await supabase.from('guard_memo_checks')
        .select('memo_id').eq('session_id', sessionId).in('memo_id', ids)
      setChecked(new Set((cks ?? []).map(c => c.memo_id)))
    } else setChecked(new Set())
    // 對象暱稱
    const pIds = [...new Set(list.filter(m => m.target_prisoner_id).map(m => m.target_prisoner_id))]
    if (pIds.length) {
      const { data: ps } = await supabase.from('profiles').select('id, game_name, display_name, inmate_no').in('id', pIds)
      const map = {}; for (const p of ps ?? []) map[p.id] = p.game_name || p.display_name || ('No.' + String(p.inmate_no ?? '').padStart(4, '0'))
      setPrisonerName(map)
    } else setPrisonerName({})
    setLoading(false)
  }, [userId, sessionId])

  useEffect(() => { load() }, [load])

  // 勾 / 取消勾(樂觀更新,失敗回滾)
  async function toggle(memo) {
    const isDone = checked.has(memo.id)
    const next = new Set(checked)
    isDone ? next.delete(memo.id) : next.add(memo.id)
    setChecked(next)
    let error
    if (isDone) {
      ({ error } = await supabase.from('guard_memo_checks').delete().eq('memo_id', memo.id).eq('session_id', sessionId))
    } else {
      ({ error } = await supabase.from('guard_memo_checks').insert({ memo_id: memo.id, session_id: sessionId }))
    }
    if (error) {
      const rollback = new Set(checked); setChecked(rollback)   // 還原
      setMsg('更新完成狀態失敗：' + error.message)
    }
  }

  return (
    <div className="card-panel sg-section">
      <div className="head">
        <h2>本場 MEMO · 確認項</h2>
        <span className="spacer" />
        <button className="btn-sm" onClick={() => setAdding(true)}>＋ 新增</button>
      </div>
      <div className="body">
        {msg && <div className="banner err" style={{ marginBottom: 10 }}>{msg}<button onClick={() => setMsg('')}>✕</button></div>}
        {loading ? <p className="empty">載入中…</p> : memos.length === 0 ? (
          <p className="empty">本場尚無確認項，點右上「＋ 新增」建立。</p>
        ) : memos.map(m => {
          const done = checked.has(m.id)
          return (
            <div key={m.id} className="memo-check">
              <input type="checkbox" checked={done} onChange={() => toggle(m)} />
              <div className="memo-check-body">
                <span className={done ? 'done-text' : ''}>{m.content}</span>
                <div className="memo-check-meta">
                  <span className={`role-tag ${m.scope === 'every' ? 'warden' : 'guard'}`}>{m.scope === 'every' ? '每場' : '本場'}</span>
                  {m.target_prisoner_id && <span className="faint">對象：{prisonerName[m.target_prisoner_id] ?? '（已不存在）'}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {adding && (
        <GuardMemoModal
          userId={userId}
          initial={null}
          preset={{ scope: 'session', sessionId }}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load() }}
        />
      )}
    </div>
  )
}
