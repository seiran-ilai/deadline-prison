import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import MessageBanner from '../MessageBanner'
import OverviewTab from './OverviewTab'
import SessionTab from './SessionTab'
import SessionsOverviewTab from './SessionsOverviewTab'
import EditMemberModal from './EditMemberModal'

export default function WardenPanel({ myRole }) {
  const isWarden = myRole === 'warden'
  const [pending, setPending] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const [inmates, setInmates] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)           // 共用資料載入中
  const [wtab, setWtab] = useState('overview')           // 主控台子頁籤
  const [editingMember, setEditingMember] = useState(null) // 編輯中的犯人資料(modal)

  // 共用資料:預約 / 全部 profiles / open 場次
  async function load() {
    setLoading(true)
    const { data: pend } = await supabase.from('pending_inmates').select('*').order('created_at')
    const { data: all } = await supabase.from('profiles').select('id, inmate_no, game_name, display_name, discord_account, avatar_url, role')
    const { data: sess } = await supabase.from('sessions').select('*').eq('status', 'open').order('created_at', { ascending: false })
    setPending(pend ?? [])
    setUnmatched((all ?? []).filter(p => p.inmate_no == null))
    setInmates((all ?? []).filter(p => p.inmate_no != null))
    setSessions(sess ?? [])
    if (sess && sess.length && !currentSession) setCurrentSession(sess[0].id)
    setLoading(false)
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
    padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
    fontWeight: wtab === k ? 700 : 400, background: wtab === k ? '#eef4ff' : '#fafafa',
    border: wtab === k ? '1px solid #5a8fd0' : '1px solid #bbb', color: '#333',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setWtab('overview')} style={subTabStyle('overview')}>名單總覽</button>
        {isWarden && <button onClick={() => setWtab('sessions')} style={subTabStyle('sessions')}>場次總覽</button>}
        <button onClick={() => setWtab('session')} style={subTabStyle('session')}>進行中場次</button>
      </div>
      <MessageBanner msg={msg} onClose={() => setMsg('')} />

      {wtab === 'session' && (
        <SessionTab
          currentSession={currentSession} setCurrentSession={setCurrentSession}
          sessions={sessions} inmates={inmates} isWarden={isWarden}
          setMsg={setMsg} reloadShared={load} />
      )}
      {wtab === 'sessions' && isWarden && (
        <SessionsOverviewTab setMsg={setMsg} reloadShared={load} />
      )}
      {wtab === 'overview' && (
        <OverviewTab inmates={inmates} unmatched={unmatched} pending={pending}
          loading={loading} isWarden={isWarden} onEditMember={openEditMember}
          setMsg={setMsg} reloadShared={load} />
      )}

      {isWarden && editingMember && (
        <EditMemberModal member={editingMember} setMember={setEditingMember} setMsg={setMsg} reloadShared={load} />
      )}
    </div>
  )
}
