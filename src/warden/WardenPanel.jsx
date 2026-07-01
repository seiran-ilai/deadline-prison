import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import MessageBanner from '../MessageBanner'
import OverviewTab from './OverviewTab'
import SessionTab from './SessionTab'
import SessionsOverviewTab from './SessionsOverviewTab'
import SalarySettlement from './SalarySettlement'
import EditMemberModal from './EditMemberModal'
import ProfileCard from '../ProfileCard'
import { normalizeStatus } from './constants'

export default function WardenPanel({ myRole, userId, onGoToManuscripts }) {
  const isWarden = myRole === 'warden'
  const [inmates, setInmates] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSession, setCurrentSession] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)           // 共用資料載入中
  const [wtab, setWtab] = useState('overview')           // 主控台子頁籤
  const [editingMember, setEditingMember] = useState(null) // 編輯中的犯人資料(modal)

  // 共用資料:全部 profiles / 進行中場次(供「進行中場次」控台用)
  // 「進行中場次」只放「開始入場」之後的場次(intake/serving);
  // booking/booking_paused 階段的操作在「場次總覽」分頁,不在此控台出現。
  async function load() {
    setLoading(true)
    const { data: all } = await supabase.from('profiles').select('id, inmate_no, game_name, display_name, discord_account, avatar_url, role, account_type')
    const { data: sess } = await supabase.from('sessions').select('*').order('created_at', { ascending: false })
    const live = (sess ?? []).filter(s => ['intake', 'serving'].includes(normalizeStatus(s)))
    setInmates(all ?? [])
    setSessions(live)
    // 目前選的場次若已不在清單(尚未入場/已結束)→ 改選第一個可用場次
    setCurrentSession(prev => (live.some(s => s.id === prev) ? prev : (live[0]?.id ?? '')))
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
      inmate_no: p.inmate_no ?? '',
      _origNo: p.inmate_no ?? null,
    })
  }

  return (
    <div>
      <ProfileCard userId={userId} />
      <div className="subtabs">
        <button className={wtab === 'overview' ? 'on' : ''} onClick={() => setWtab('overview')}>名單總覽</button>
        {isWarden && <button className={wtab === 'sessions' ? 'on' : ''} onClick={() => setWtab('sessions')}>場次總覽</button>}
        <button className={wtab === 'session' ? 'on' : ''} onClick={() => setWtab('session')}>進行中場次</button>
        {isWarden && <button className={wtab === 'settlement' ? 'on' : ''} onClick={() => setWtab('settlement')}>薪資結算</button>}
      </div>
      <MessageBanner msg={msg} onClose={() => setMsg('')} />

      {wtab === 'session' && (
        <SessionTab
          currentSession={currentSession} setCurrentSession={setCurrentSession}
          sessions={sessions} inmates={inmates} isWarden={isWarden}
          setMsg={setMsg} reloadShared={load} onGoToManuscripts={onGoToManuscripts} />
      )}
      {wtab === 'sessions' && isWarden && (
        <SessionsOverviewTab setMsg={setMsg} reloadShared={load} inmates={inmates} />
      )}
      {wtab === 'overview' && (
        <OverviewTab inmates={inmates}
          loading={loading} isWarden={isWarden} onEditMember={openEditMember}
          setMsg={setMsg} reloadShared={load} />
      )}
      {wtab === 'settlement' && isWarden && (
        <SalarySettlement currentSession={currentSession} setMsg={setMsg} />
      )}

      {isWarden && editingMember && (
        <EditMemberModal member={editingMember} setMember={setEditingMember} setMsg={setMsg} reloadShared={load} />
      )}
    </div>
  )
}
