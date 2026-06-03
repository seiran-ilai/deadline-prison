import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function IntakeTab({ pending, unmatched, setMsg, reloadShared }) {
  const [form, setForm] = useState({ game_name: '', discord_account: '', avatar_url: '' })

  async function addPending() {
    if (!form.game_name || !form.discord_account) { setMsg('遊戲暱稱和 Discord 帳號必填'); return }
    const { error } = await supabase.from('pending_inmates').insert({
      game_name: form.game_name, discord_account: form.discord_account, avatar_url: form.avatar_url || null })
    if (error) { setMsg('新增失敗:' + error.message); return }
    setMsg('已加入預約名單'); setForm({ game_name: '', discord_account: '', avatar_url: '' }); reloadShared()
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

  return (
    <div>
      <h3 style={{ marginTop: 24 }}>新增預約犯人</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input placeholder="遊戲暱稱" value={form.game_name} onChange={e => setForm({ ...form, game_name: e.target.value })} />
        <input placeholder="Discord 使用者名稱" value={form.discord_account} onChange={e => setForm({ ...form, discord_account: e.target.value })} />
        <input placeholder="頭貼網址(選填)" value={form.avatar_url} onChange={e => setForm({ ...form, avatar_url: e.target.value })} />
        <button onClick={addPending}>加入預約</button>
      </div>

      <h3 style={{ marginTop: 24, color: '#c60' }}>⚠️ 未配對登入者</h3>
      {unmatched.length === 0 ? <p style={{ color: '#888' }}>沒有未配對的人</p> : (
        <ul>{unmatched.map(p => (
          <li key={p.id} style={{ marginBottom: 8 }}>{p.discord_account}
            <button onClick={() => linkToPending(p.id)} style={{ marginLeft: 10 }}>指到預約</button>
            <button onClick={() => admitDirect(p.id)} style={{ marginLeft: 6 }}>直接收押</button>
          </li>))}</ul>
      )}

      <h3 style={{ marginTop: 24 }}>預約名單</h3>
      {pending.length === 0 ? <p style={{ color: '#888' }}>目前沒有預約</p> : (
        <ul>{pending.map(p => <li key={p.id}>{p.game_name}（{p.discord_account}）</li>)}</ul>
      )}
    </div>
  )
}
