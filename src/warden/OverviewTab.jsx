import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { ProgressBar } from '../ManuscriptManager'
import { ROLE_LABEL, OVERVIEW_STATUS_STYLE, memberStatusLabel } from './constants'
import { computeProgress } from '../progress'
import AvatarInput from '../AvatarInput'

// 名單總覽:一份清單、三種狀態 —
//   已配號(profiles 有 inmate_no)、未配對(profiles 無 inmate_no)、預約中(pending_inmates)。
// 新增預約表單也搬到這裡(取代原「預約與收押」分頁)。
export default function OverviewTab({ inmates, unmatched = [], pending = [], loading, isWarden, onEditMember, setMsg, reloadShared }) {
  const [visitCount, setVisitCount] = useState({})       // member_id -> 光臨次數
  const [memberSession, setMemberSession] = useState({}) // member_id -> 目前所在 open 場次
  const [expandedMember, setExpandedMember] = useState(null) // 展開中的 member_id
  const [memberWorks, setMemberWorks] = useState({})     // member_id -> [稿件+進度]
  const [showForm, setShowForm] = useState(false)        // 新增預約表單開關
  const [form, setForm] = useState({ game_name: '', discord_account: '', avatar_url: '' })

  // 總覽:光臨次數 + 目前狀態(分開查再合併)
  async function loadOverview() {
    const { data: allSi } = await supabase.from('session_inmates').select('member_id, session_id')
    const { data: openSess } = await supabase.from('sessions')
      .select('id, timer_started_at, timer_ended_at, total_rounds').eq('status', 'open')
    const openById = {}; for (const s of openSess ?? []) openById[s.id] = s
    const counts = {}, memSess = {}
    for (const r of allSi ?? []) {
      counts[r.member_id] = (counts[r.member_id] ?? 0) + 1
      if (openById[r.session_id] && !memSess[r.member_id]) memSess[r.member_id] = openById[r.session_id]
    }
    setVisitCount(counts); setMemberSession(memSess)
  }
  useEffect(() => { loadOverview() }, [])

  // 點開某人 → 載入他的稿件 + 進度(staff 可讀全部,含 private)
  async function toggleMember(memberId) {
    if (expandedMember === memberId) { setExpandedMember(null); return }
    setExpandedMember(memberId)
    if (memberWorks[memberId]) return
    const { data: ms } = await supabase.from('manuscripts')
      .select('id, title, status, visibility, is_done').eq('member_id', memberId).order('priority').order('created_at')
    const msIds = (ms ?? []).map(m => m.id)
    let steps = []
    if (msIds.length) {
      const { data: st } = await supabase.from('manuscript_steps').select('manuscript_id, done').in('manuscript_id', msIds)
      steps = st ?? []
    }
    const agg = {}
    for (const s of steps) { (agg[s.manuscript_id] ??= { done: 0, total: 0 }).total++; if (s.done) agg[s.manuscript_id].done++ }
    const works = (ms ?? []).map(m => ({ ...m, done: agg[m.id]?.done ?? 0, total: agg[m.id]?.total ?? 0 }))
    setMemberWorks(prev => ({ ...prev, [memberId]: works }))
  }

  // ── 預約 / 配號動作(沿用原「預約與收押」邏輯,不重寫) ──
  async function addPending() {
    if (!form.game_name || !form.discord_account) { setMsg('遊戲暱稱和 Discord 帳號必填'); return }
    const { error } = await supabase.from('pending_inmates').insert({
      game_name: form.game_name, discord_account: form.discord_account, avatar_url: form.avatar_url || null })
    if (error) { setMsg('新增失敗:' + error.message); return }
    setMsg('已加入預約名單'); setForm({ game_name: '', discord_account: '', avatar_url: '' }); setShowForm(false); reloadShared()
  }

  async function admitDirect(userId) {
    const name = prompt('請輸入遊戲暱稱:'); if (!name) return
    const { error } = await supabase.rpc('admit_unmatched', { target_id: userId, p_game_name: name })
    if (error) { setMsg('收押失敗:' + error.message); return }
    setMsg('已收押'); reloadShared()
  }

  async function linkToPending(userId) {
    if (pending.length === 0) { setMsg('沒有預約資料可指定'); return }
    const list = pending.map((p, i) => `${i + 1}. ${p.game_name}（${p.discord_account}）`).join('\n')
    const idx = parseInt(prompt('指到哪筆預約?輸入編號:\n' + list)) - 1
    if (isNaN(idx) || !pending[idx]) return
    const { error } = await supabase.rpc('link_to_pending', { target_id: userId, pending_id: pending[idx].id })
    if (error) { setMsg('指定失敗:' + error.message); return }
    setMsg('已指定並收押'); reloadShared()
  }

  async function deletePending(id) {
    if (!window.confirm('確定刪除這筆預約?')) return
    const { error } = await supabase.from('pending_inmates').delete().eq('id', id)
    if (error) { setMsg('刪除預約失敗:' + error.message); return }
    setMsg('已刪除預約'); reloadShared()
  }

  return (
    <div>
      <h3>名單總覽</h3>

      {/* 新增預約(搬自原「預約與收押」) */}
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setShowForm(v => !v)}>
          {showForm ? '收起' : '＋ 新增預約'}
        </button>
        {showForm && (
          <div className="toolbar" style={{ marginTop: 8, alignItems: 'flex-start' }}>
            <input className="inp" placeholder="遊戲暱稱" value={form.game_name} onChange={e => setForm({ ...form, game_name: e.target.value })} />
            <input className="inp" placeholder="Discord 使用者名稱" value={form.discord_account} onChange={e => setForm({ ...form, discord_account: e.target.value })} />
            <div className="field" style={{ minWidth: 240 }}>
              <span className="field-lbl">頭像(選填)</span>
              <AvatarInput value={form.avatar_url} onChange={url => setForm({ ...form, avatar_url: url })} userId={'pending'} />
            </div>
            <button onClick={addPending}>加入預約</button>
          </div>
        )}
      </div>

      {loading ? <p className="empty">載入中…</p> : (() => {
        const hasAny = inmates.length || unmatched.length || pending.length
        if (!hasAny) return <p className="empty">名單還沒有任何人</p>
        return (<>
          {/* 1) 未配對置頂(要處理) */}
          {unmatched.map(p => (
            <div key={'u-' + p.id} className="row-card">
              <div className="row-head">
                <span className="tag tag-pill" style={{ background: 'rgba(245,197,24,.15)', color: 'var(--hazard)' }}>未配對 · 查無預約</span>
                <strong>{p.discord_account ?? p.display_name ?? '(未知)'}</strong>
                <span className="spacer" />
                <button className="btn-sm" onClick={() => linkToPending(p.id)}>指到預約</button>
                <button className="btn-sm" onClick={() => admitDirect(p.id)}>直接收押</button>
              </div>
            </div>
          ))}

          {/* 2) 已配號 profiles(沿用原總覽:狀態 / 光臨 / 展開稿件 / 編輯) */}
          {inmates.map(p => {
            const status = memberStatusLabel(memberSession[p.id])
            const ss = OVERVIEW_STATUS_STYLE[status] ?? { bg: '#eee', color: '#888' }
            const isOpen = expandedMember === p.id
            const works = memberWorks[p.id]
            return (
              <div key={p.id} className="row-card">
                <div className="row-head clickable" onClick={() => toggleMember(p.id)}>
                  <strong>No.{String(p.inmate_no).padStart(4, '0')}</strong>
                  <span>{p.game_name ?? p.display_name}</span>
                  <span className={`role-tag ${p.role ?? 'member'}`}>{ROLE_LABEL[p.role] ?? '犯人'}</span>
                  <span className="muted">光臨 {visitCount[p.id] ?? 0} 次</span>
                  <span className="spacer" />
                  <span className="tag tag-pill" style={{ background: ss.bg, color: ss.color }}>{status}</span>
                  {isWarden && (
                    <button className="btn-sm" onClick={e => { e.stopPropagation(); onEditMember(p) }}>編輯</button>
                  )}
                  <span className="muted">{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div className="row-detail">
                    {!works ? <p className="empty">讀取稿件中…</p>
                      : works.length === 0 ? <p className="empty">這位沒有稿件</p>
                        : works.map(w => (
                          <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', flexWrap: 'wrap' }}>
                            <span style={{ flex: '0 0 160px', fontSize: 14 }}>
                              {w.title}{w.status === 'archived' && <span className="faint">(封存)</span>}
                            </span>
                            <div style={{ flex: 1, minWidth: 140 }}><ProgressBar progress={computeProgress({ done: w.done, total: w.total, isDone: w.is_done })} /></div>
                          </div>
                        ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* 3) 預約中(尚未登入) */}
          {pending.map(p => (
            <div key={'p-' + p.id} className="row-card">
              <div className="row-head">
                <span className="tag tag-pill" style={{ background: 'rgba(255,255,255,.08)', color: 'var(--dim)' }}>預約中 · 未登入</span>
                <strong>{p.game_name}</strong>
                <span className="muted">Discord:{p.discord_account}</span>
                <span className="spacer" />
                <button className="btn-sm btn-danger" onClick={() => deletePending(p.id)}>刪除</button>
              </div>
            </div>
          ))}
        </>)
      })()}
    </div>
  )
}
