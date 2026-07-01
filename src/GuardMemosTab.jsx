import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'
import GuardMemoModal from './GuardMemoModal'

// 獄卒「MEMO / 確認項」管理分頁:只列自己的 MEMO,分「每場」與各「指定場」分組,可編輯 / 刪除。
// 完成狀態屬「服刑中按場勾」,此處不處理(見 SessionMemoPanel)。
export default function GuardMemosTab({ userId }) {
  const [memos, setMemos] = useState([])
  const [sessionTitle, setSessionTitle] = useState({})   // session_id -> title
  const [prisonerName, setPrisonerName] = useState({})   // profile_id -> name
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)               // null | { initial } 開著的 modal
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: rows, error } = await supabase.from('guard_memos')
      .select('id, content, scope, session_id, target_prisoner_id, created_at')
      .eq('guard_id', userId).order('created_at', { ascending: false })
    if (error) { setMemos([]); setLoading(false); setMsg('讀取失敗：' + error.message); return }
    const list = rows ?? []
    setMemos(list)
    // 解析場次標題 + 對象暱稱(分開查再合併)
    const sIds = [...new Set(list.filter(m => m.session_id).map(m => m.session_id))]
    const pIds = [...new Set(list.filter(m => m.target_prisoner_id).map(m => m.target_prisoner_id))]
    if (sIds.length) {
      const { data: ss } = await supabase.from('sessions').select('id, title').in('id', sIds)
      const map = {}; for (const s of ss ?? []) map[s.id] = s.title; setSessionTitle(map)
    } else setSessionTitle({})
    if (pIds.length) {
      const { data: ps } = await supabase.from('profiles').select('id, game_name, display_name, inmate_no').in('id', pIds)
      const map = {}; for (const p of ps ?? []) map[p.id] = p.game_name || p.display_name || ('No.' + String(p.inmate_no ?? '').padStart(4, '0'))
      setPrisonerName(map)
    } else setPrisonerName({})
    setLoading(false)
  }, [userId])

  useEffect(() => { load() }, [load])

  async function remove(memo) {
    if (!window.confirm('確定刪除這條 MEMO？所有場次的完成紀錄也會一併移除')) return
    const { error } = await supabase.from('guard_memos').delete().eq('id', memo.id)
    if (error) { setMsg('刪除失敗：' + error.message); return }
    setMsg('已刪除'); load()
  }

  const everyMemos = memos.filter(m => m.scope === 'every')
  const sessionMemos = memos.filter(m => m.scope === 'session')
  // 指定場依 session_id 分組(維持原排序)
  const bySession = {}
  for (const m of sessionMemos) (bySession[m.session_id] ??= []).push(m)

  // 卡片式(網格排列):標籤 + 對象 → 內容 → 動作,避免整條滿版留白
  const renderMemo = (m) => (
    <div key={m.id} className="memo-card">
      <div className="memo-card-top">
        <span className={`role-tag ${m.scope === 'every' ? 'warden' : 'guard'}`}>{m.scope === 'every' ? '每場' : '指定場'}</span>
        {m.target_prisoner_id && <span className="faint memo-obj">對象：{prisonerName[m.target_prisoner_id] ?? '（已不存在）'}</span>}
      </div>
      <div className="memo-content">{m.content}</div>
      <div className="memo-card-acts">
        <button className="btn-sm" onClick={() => setModal({ initial: m })}>編輯</button>
        <button className="btn-sm btn-danger" onClick={() => remove(m)}>刪除</button>
      </div>
    </div>
  )

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>我的 MEMO / 確認項</h3>
        <button className="btn-pri" onClick={() => setModal({ initial: null })}>＋ 新增 MEMO</button>
      </div>
      {msg && <div className="banner ok" style={{ marginTop: 10 }}>{msg}<button onClick={() => setMsg('')}>✕</button></div>}

      {loading ? <p className="empty">載入中…</p> : memos.length === 0 ? (
        <p className="empty">還沒有任何 MEMO，點右上「＋ 新增 MEMO」建立。</p>
      ) : (
        <>
          <div className="group-lbl">每場 MEMO ({everyMemos.length})<span className="ln" /></div>
          {everyMemos.length === 0 ? <p className="empty">沒有每場 MEMO</p> : <div className="memo-grid">{everyMemos.map(renderMemo)}</div>}

          {Object.keys(bySession).map(sid => (
            <div key={sid}>
              <div className="group-lbl">指定場：{sessionTitle[sid] ?? '（場次已刪除）'} ({bySession[sid].length})<span className="ln" /></div>
              <div className="memo-grid">{bySession[sid].map(renderMemo)}</div>
            </div>
          ))}
        </>
      )}

      {modal && (
        <GuardMemoModal
          userId={userId}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setMsg(modal.initial ? '已更新' : '已新增'); load() }}
        />
      )}
    </div>
  )
}
