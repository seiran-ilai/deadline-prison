import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import { normalizeStatus } from './warden/constants'

// 新增 / 編輯 獄卒 MEMO 的共用 modal(設計系統 modal 樣式)。
// props:
//   userId   登入獄卒 id(= guard_id)
//   initial  編輯時帶入的 memo 物件;null = 新增
//   preset   新增時的預設 { scope, sessionId }(服刑中面板帶「指定場=本場」)
//   onClose() / onSaved()
export default function GuardMemoModal({ userId, initial, preset, onClose, onSaved }) {
  const [content, setContent] = useState(initial?.content ?? '')
  const [scope, setScope] = useState(initial?.scope ?? preset?.scope ?? 'every')
  const [sessionId, setSessionId] = useState(initial?.session_id ?? preset?.sessionId ?? '')
  const [targetId, setTargetId] = useState(initial?.target_prisoner_id ?? '')
  const [sessions, setSessions] = useState([])     // 所有未結束場次(normalizeStatus !== 'ended')
  const [prisoners, setPrisoners] = useState([])   // 綁定對象候選
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // 場次下拉:列出所有未結束場次(全撈 + normalizeStatus !== 'ended' 過濾,
  // 涵蓋 booking/booking_paused/intake/serving;過渡期舊值 open/closed 也正規化,不用 .eq('status','open'))
  useEffect(() => {
    let alive = true
    supabase.from('sessions').select('id, title, session_date, status, timer_started_at')
      .order('session_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        if (alive) setSessions((data ?? []).filter(s => normalizeStatus(s) !== 'ended'))
      })
    return () => { alive = false }
  }, [])

  // 綁定對象候選:指定場 → 該場犯人;每場 → 可讀的全部犯人(role='member')
  useEffect(() => {
    let alive = true
    async function loadPrisoners() {
      if (scope === 'session') {
        if (!sessionId) { if (alive) setPrisoners([]); return }
        const { data: si } = await supabase.from('session_inmates')
          .select('member_id, role_in_session').eq('session_id', sessionId)
        const ids = (si ?? []).filter(r => r.role_in_session !== 'guard').map(r => r.member_id)
        if (!ids.length) { if (alive) setPrisoners([]); return }
        const { data: profs } = await supabase.from('profiles')
          .select('id, inmate_no, game_name, display_name').in('id', ids)
        if (alive) setPrisoners(profs ?? [])
      } else {
        const { data: profs } = await supabase.from('profiles')
          .select('id, inmate_no, game_name, display_name').eq('role', 'member').order('inmate_no')
        if (alive) setPrisoners(profs ?? [])
      }
    }
    loadPrisoners()
    return () => { alive = false }
  }, [scope, sessionId])

  // 切到「每場」時清掉指定場;對象若已不在新候選內,交由 select 自然落回空(存檔時再驗)
  function changeScope(next) { setScope(next); if (next === 'every') setSessionId('') }

  async function save() {
    setErr('')
    if (!content.trim()) { setErr('請填 MEMO 內容'); return }
    if (scope === 'session' && !sessionId) { setErr('「指定場」請選一個場次'); return }
    setSaving(true)
    const payload = {
      content: content.trim(),
      scope,
      session_id: scope === 'session' ? sessionId : null,
      target_prisoner_id: targetId || null,
    }
    let error
    if (initial) {
      ({ error } = await supabase.from('guard_memos').update(payload).eq('id', initial.id))
    } else {
      ({ error } = await supabase.from('guard_memos').insert({ ...payload, guard_id: userId }))
    }
    setSaving(false)
    if (error) { setErr('儲存失敗:' + error.message); return }
    onSaved()
  }

  const pName = (p) => p.game_name || p.display_name || ('No.' + String(p.inmate_no ?? '').padStart(4, '0'))

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>{initial ? '編輯 MEMO' : '新增 MEMO'}</h3>

        <label>內容
          <textarea rows={3} value={content} onChange={e => setContent(e.target.value)} placeholder="例:提醒犯人交稿前先存檔" />
        </label>

        <div className="field">
          <span className="field-lbl">適用範圍</span>
          <div className="memo-radios">
            <label className="memo-radio"><input type="radio" name="memo-scope" checked={scope === 'every'} onChange={() => changeScope('every')} /> 每場</label>
            <label className="memo-radio"><input type="radio" name="memo-scope" checked={scope === 'session'} onChange={() => changeScope('session')} /> 指定場</label>
          </div>
        </div>

        {scope === 'session' && (
          <label>場次(進行中 / 預約中)
            <select value={sessionId} onChange={e => setSessionId(e.target.value)}>
              <option value="">— 選一個場次 —</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.title}{s.session_date ? `(${String(s.session_date).slice(0, 10)})` : ''}</option>)}
            </select>
          </label>
        )}

        <label>綁定對象(選填)
          <select value={targetId} onChange={e => setTargetId(e.target.value)}>
            <option value="">— 不綁定 —</option>
            {prisoners.map(p => <option key={p.id} value={p.id}>{pName(p)}</option>)}
          </select>
        </label>

        {err && <p className="warn">{err}</p>}
        <div className="modal-acts">
          <button onClick={onClose} disabled={saving}>取消</button>
          <button className="btn-pri" onClick={save} disabled={saving}>{saving ? '儲存中…' : '儲存'}</button>
        </div>
      </div>
    </div>
  )
}
