import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import OverviewTab from './OverviewTab'
import SessionTab from './SessionTab'
import IntakeTab from './IntakeTab'
import EditMemberModal from './EditMemberModal'

export default function WardenPanel({ myRole }) {
  const isWarden = myRole === 'warden'
  const [pending, setPending] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const [inmates, setInmates] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState('')
  const [msg, setMsg] = useState('')
  const [wtab, setWtab] = useState('overview')           // 主控台子頁籤
  const [editingMember, setEditingMember] = useState(null) // 編輯中的犯人資料(modal)

  // 共用資料:預約 / 全部 profiles / open 場次
  async function load() {
    const { data: pend } = await supabase.from('pending_inmates').select('*').order('created_at')
    const { data: all } = await supabase.from('profiles').select('id, inmate_no, game_name, display_name, discord_account, avatar_url, role')
    const { data: sess } = await supabase.from('sessions').select('*').eq('status', 'open').order('created_at', { ascending: false })
    setPending(pend ?? [])
    setUnmatched((all ?? []).filter(p => p.inmate_no == null))
    setInmates((all ?? []).filter(p => p.inmate_no != null))
    setSessions(sess ?? [])
    if (sess && sess.length && !currentSession) setCurrentSession(sess[0].id)
  }
  useEffect(() => { load() }, [])

  // 編輯犯人資料(僅 warden 看得到入口)
  function openEditMember(p) {
    setEditingMember({
      id: p.id,
      game_name: p.game_name ?? '',
      avatar_url: p.avatar_url ?? '',
      discord_account: p.discord_account ?? '',
      role: p.role ?? 'member',
      _origRole: p.role ?? 'member',
    })
  }

  const subTabStyle = (k) => ({
    padding: '6px 14px', border: '1px solid #bbb', borderRadius: 4, cursor: 'pointer',
    fontWeight: wtab === k ? 700 : 400, background: wtab === k ? '#eef4ff' : '#fafafa', color: '#333',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setWtab('overview')} style={subTabStyle('overview')}>總覽</button>
        <button onClick={() => setWtab('session')} style={subTabStyle('session')}>本場</button>
        <button onClick={() => setWtab('intake')} style={subTabStyle('intake')}>預約與收押</button>
      </div>
      {msg && <p style={{ color: '#2a7' }}>{msg}</p>}

      {wtab === 'session' && (
        <SessionTab
          currentSession={currentSession} setCurrentSession={setCurrentSession}
          sessions={sessions} inmates={inmates} isWarden={isWarden}
          setMsg={setMsg} reloadShared={load} />
      )}
      {wtab === 'intake' && (
        <IntakeTab pending={pending} unmatched={unmatched} setMsg={setMsg} reloadShared={load} />
      )}
      {wtab === 'overview' && (
        <OverviewTab inmates={inmates} isWarden={isWarden} onEditMember={openEditMember} />
      )}

      {isWarden && editingMember && (
        <EditMemberModal member={editingMember} setMember={setEditingMember} setMsg={setMsg} reloadShared={load} />
      )}
    </div>
  )
}
