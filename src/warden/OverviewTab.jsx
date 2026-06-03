import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { ProgressBar } from '../ManuscriptManager'
import { ROLE_LABEL, OVERVIEW_STATUS_STYLE, memberStatusLabel } from './constants'

export default function OverviewTab({ inmates, isWarden, onEditMember }) {
  const [visitCount, setVisitCount] = useState({})       // member_id -> 光臨次數
  const [memberSession, setMemberSession] = useState({}) // member_id -> 目前所在 open 場次
  const [expandedMember, setExpandedMember] = useState(null) // 展開中的 member_id
  const [memberWorks, setMemberWorks] = useState({})     // member_id -> [稿件+進度]

  // 總覽:光臨次數 + 目前狀態(分開查再合併)
  async function loadOverview() {
    const { data: allSi } = await supabase.from('session_inmates').select('member_id, session_id')
    const { data: openSess } = await supabase.from('sessions')
      .select('id, timer_started_at, total_rounds').eq('status', 'open')
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
      .select('id, title, status, visibility').eq('member_id', memberId).order('priority').order('created_at')
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

  return (
    <div>
      <h3>犯人總覽</h3>
      {inmates.length === 0 ? <p style={{ color: '#888' }}>還沒有人在押</p> : inmates.map(p => {
        const status = memberStatusLabel(memberSession[p.id])
        const ss = OVERVIEW_STATUS_STYLE[status] ?? { bg: '#eee', color: '#888' }
        const isOpen = expandedMember === p.id
        const works = memberWorks[p.id]
        return (
          <div key={p.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 8, background: '#fff', color: '#222' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => toggleMember(p.id)}>
              <strong>No.{String(p.inmate_no).padStart(4, '0')}</strong>
              <span>{p.game_name ?? p.display_name}</span>
              <span style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: '#eef', color: '#558' }}>{ROLE_LABEL[p.role] ?? '犯人'}</span>
              <span style={{ color: '#888', fontSize: 13 }}>光臨 {visitCount[p.id] ?? 0} 次</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: ss.bg, color: ss.color }}>{status}</span>
              {isWarden && (
                <button style={{ padding: '2px 10px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); onEditMember(p) }}>編輯</button>
              )}
              <span style={{ color: '#888' }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 10, borderTop: '1px dashed #ddd', paddingTop: 10 }}>
                {!works ? <p style={{ color: '#999', margin: 0 }}>讀取稿件中…</p>
                  : works.length === 0 ? <p style={{ color: '#999', margin: 0 }}>這位沒有稿件</p>
                    : works.map(w => (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                        <span style={{ flex: '0 0 160px', fontSize: 14 }}>
                          {w.title}{w.status === 'archived' && <span style={{ color: '#aaa' }}>(封存)</span>}
                        </span>
                        <div style={{ flex: 1 }}><ProgressBar done={w.done} total={w.total} /></div>
                      </div>
                    ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
