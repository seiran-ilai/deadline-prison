import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { ROLE_LABEL } from './constants'
import AvatarInput from '../AvatarInput'

// 名單總覽(卡片網格版):一份清單、三種狀態 —
//   已配號(profiles 有 inmate_no,分獄卒區 / 犯人區)、未配對(profiles 無 inmate_no)、預約中(pending_inmates)。
// 待處理區(未配對 + 預約中)置頂;搜尋 / 排序只作用於已配號的獄卒區與犯人區。
// 不再顯示光臨次數、目前狀態,也不再展開看稿件進度(簡化)。
export default function OverviewTab({ inmates, unmatched = [], pending = [], loading, isWarden, onEditMember, setMsg, reloadShared }) {
  const [showForm, setShowForm] = useState(false)        // 新增預約表單開關
  const [form, setForm] = useState({ game_name: '', discord_account: '', avatar_url: '' })
  const [q, setQ] = useState('')                          // 已配號清單搜尋(暱稱 / 編號)
  const [sortDir, setSortDir] = useState('asc')           // 已配號清單排序:asc=編號舊→新(預設) / desc=新→舊

  // ── 預約 / 配號動作(沿用原「預約與收押」邏輯,不重寫) ──
  async function addPending() {
    if (!form.game_name || !form.discord_account) { setMsg('遊戲暱稱和 Discord 帳號必填'); return }
    const { error } = await supabase.from('pending_inmates').insert({
      game_name: form.game_name, discord_account: form.discord_account, avatar_url: form.avatar_url || null })
    if (error) { setMsg('新增失敗:' + error.message); return }
    setMsg('已加入預約名單'); setForm({ game_name: '', discord_account: '', avatar_url: '' }); setShowForm(false); reloadShared()
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

  // 給未配對者下一個編號(RPC assign_next_inmate_no;成功後重載共用資料,該員移入已配號)
  async function assignNextNo(userId) {
    const { error } = await supabase.rpc('assign_next_inmate_no', { target_id: userId })
    if (error) { setMsg('給號失敗:' + error.message); return }
    setMsg('已指派下一個編號'); reloadShared()
  }

  // 已配號清單:前端即時過濾(暱稱 / 編號含補零 4 位)+ 依編號排序
  const ql = q.trim().toLowerCase()
  const shownInmates = inmates
    .filter(p => {
      if (!ql) return true
      const name = (p.game_name ?? p.display_name ?? '').toLowerCase()
      const no = String(p.inmate_no ?? '')
      return name.includes(ql) || no.includes(ql) || no.padStart(4, '0').includes(ql)
    })
    .slice()
    .sort((a, b) => sortDir === 'asc'
      ? (a.inmate_no ?? 0) - (b.inmate_no ?? 0)
      : (b.inmate_no ?? 0) - (a.inmate_no ?? 0))

  const staff = shownInmates.filter(p => p.role === 'guard' || p.role === 'warden')
  const members = shownInmates.filter(p => p.role !== 'guard' && p.role !== 'warden')

  // 已配號卡片(獄卒區 / 犯人區):頭貼 + 暱稱 + 編號 + 角色標籤 + 編輯
  const MemberCard = (p) => {
    const roleClass = p.role === 'warden' ? 'warden' : p.role === 'guard' ? 'guard' : 'member'
    const isStaffCard = roleClass === 'guard' || roleClass === 'warden'
    const name = p.game_name ?? p.display_name ?? '(未命名)'
    return (
      <div key={p.id} className={`ov-card${isStaffCard ? ' staff' : ''}`}>
        <div className="ov-av">
          {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <span>{name[0] ?? '?'}</span>}
        </div>
        <div className="ov-nm">{name}</div>
        <div className="ov-no">No.{String(p.inmate_no).padStart(4, '0')}</div>
        <span className={`role-tag ${roleClass}`}>{ROLE_LABEL[p.role] ?? '犯人'}</span>
        {isWarden && (
          <div className="ov-acts">
            <button className="btn-sm" onClick={() => onEditMember(p)}>編輯</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ov-page">
      <div className="ov-head">
        <h3>名單總覽</h3>
        <span className="spacer" />
        <input className="inp" placeholder="搜尋暱稱 / 編號" value={q} onChange={e => setQ(e.target.value)} />
        <select className="sel" value={sortDir} onChange={e => setSortDir(e.target.value)}>
          <option value="asc">編號 舊→新</option>
          <option value="desc">編號 新→舊</option>
        </select>
        <button onClick={() => setShowForm(v => !v)}>{showForm ? '收起' : '＋ 新增預約'}</button>
      </div>

      {/* 新增預約(搬自原「預約與收押」) */}
      {showForm && (
        <div className="toolbar" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <input className="inp" placeholder="遊戲暱稱" value={form.game_name} onChange={e => setForm({ ...form, game_name: e.target.value })} />
          <input className="inp" placeholder="Discord 使用者名稱" value={form.discord_account} onChange={e => setForm({ ...form, discord_account: e.target.value })} />
          <div className="field" style={{ minWidth: 240 }}>
            <span className="field-lbl">頭像(選填)</span>
            <AvatarInput value={form.avatar_url} onChange={url => setForm({ ...form, avatar_url: url })} userId={'pending'} />
          </div>
          <button onClick={addPending}>加入預約</button>
        </div>
      )}

      {loading ? <p className="empty">載入中…</p> : (() => {
        const hasAny = inmates.length || unmatched.length || pending.length
        if (!hasAny) return <p className="empty">名單還沒有任何人</p>
        return (<>
          {/* 1) 待處理區(置頂):未配對(查無預約) + 預約中(未登入) */}
          {(unmatched.length > 0 || pending.length > 0) && (
            <section className="ov-group">
              <div className="subgroup">待處理 ({unmatched.length + pending.length})<span className="ln" /></div>
              <div className="ov-grid">
                {unmatched.map(p => {
                  const name = p.discord_account ?? p.display_name ?? '(未知)'
                  return (
                    <div key={'u-' + p.id} className="ov-card todo">
                      <div className="ov-av">
                        {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <span>{name[0] ?? '?'}</span>}
                      </div>
                      <div className="ov-nm">{name}</div>
                      <span className="tag tag-pill" style={{ background: 'rgba(245,197,24,.15)', color: 'var(--hazard)' }}>查無預約</span>
                      <div className="ov-acts">
                        <button className="btn-sm" onClick={() => assignNextNo(p.id)}>給下一號</button>
                        <button className="btn-sm" onClick={() => linkToPending(p.id)}>指到預約</button>
                      </div>
                    </div>
                  )
                })}
                {pending.map(p => (
                  <div key={'p-' + p.id} className="ov-card todo">
                    <div className="ov-av">
                      {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <span>{(p.game_name ?? '?')[0]}</span>}
                    </div>
                    <div className="ov-nm">{p.game_name}</div>
                    <div className="ov-no">DC:{p.discord_account}</div>
                    <span className="tag tag-pill" style={{ background: 'rgba(255,255,255,.08)', color: 'var(--dim)' }}>預約中</span>
                    <div className="ov-acts">
                      <button className="btn-sm btn-danger" onClick={() => deletePending(p.id)}>刪除</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 2) 獄卒區(role in guard/warden,綠框點綴) */}
          {staff.length > 0 && (
            <section className="ov-group">
              <div className="subgroup mine">獄方 ({staff.length})<span className="ln" /></div>
              <div className="ov-grid">{staff.map(MemberCard)}</div>
            </section>
          )}

          {/* 3) 犯人區(role = member) */}
          <section className="ov-group">
            <div className="subgroup">犯人 ({members.length})<span className="ln" /></div>
            {members.length === 0 ? <p className="empty">{ql ? '沒有符合的犯人' : '尚無已配號犯人'}</p>
              : <div className="ov-grid">{members.map(MemberCard)}</div>}
          </section>
        </>)
      })()}
    </div>
  )
}
