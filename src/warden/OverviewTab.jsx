import { useState, useRef, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { ROLE_LABEL } from './constants'
import { CreateAccountSection, RenameAccountModal, IssueCredentialsModal } from './AccountAdmin'

// 卡片右上角「⋯」動作選單:點擊展開,點外面或選完即收。沿用後台既有按鈕語彙。
function CardMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div className="gc-menu" ref={ref}>
      <button type="button" className="gc-menu-btn" aria-label="更多動作" onClick={() => setOpen(o => !o)}>⋯</button>
      {open && (
        <div className="gc-menu-pop">
          {items.map((it, i) => (
            <button key={i} type="button" className="gc-menu-item" onClick={() => { setOpen(false); it.onClick() }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 名單總覽(卡片網格版):已配號清單,分獄卒區 / 犯人區。
// 登入即建檔發號,不再有「未配對 / 預約中」待處理區;搜尋 / 排序作用於整份清單。
// 不再顯示光臨次數、目前狀態,也不再展開看稿件進度(簡化)。
// warden 另有「收監登記」區塊(代開帳號),與代開帳號(account_type='warden_created')
// 卡片上的「重設密碼 / 改帳號名」操作。
export default function OverviewTab({ inmates, loading, isWarden, onEditMember, setMsg, reloadShared }) {
  const [q, setQ] = useState('')                          // 清單搜尋(暱稱 / 編號)
  const [sortDir, setSortDir] = useState('asc')           // 排序:asc=編號舊→新(預設) / desc=新→舊
  const [renameTarget, setRenameTarget] = useState(null)  // 代開/核發帳號:改帳號名對象
  const [issueTarget, setIssueTarget] = useState(null)    // 核發帳密對象(首發或重發蓋過)
  const [ov, setOv] = useState({})                        // 樂觀覆寫:id -> { portrait_only, offers_polaroid }(避免整頁 reloadShared)

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

  // 全域設定:是否提供加購拍立得 / 肖像畫負責。純樂觀本地更新,不 reloadShared(避免整頁刷新);失敗才回滾。
  const nm = p => p.game_name ?? p.display_name ?? ''
  const polOf = p => ov[p.id]?.offers_polaroid ?? (p.offers_polaroid !== false)
  const porOf = p => ov[p.id]?.portrait_only ?? !!p.portrait_only
  async function toggleOffersPolaroid(p) {
    const cur = polOf(p), val = !cur
    setOv(o => ({ ...o, [p.id]: { ...o[p.id], offers_polaroid: val } }))
    const { error } = await supabase.from('profiles').update({ offers_polaroid: val }).eq('id', p.id)
    if (error) { setOv(o => ({ ...o, [p.id]: { ...o[p.id], offers_polaroid: cur } })); setMsg('更新失敗：' + error.message); return }
    setMsg(val ? `已開放 ${nm(p)} 加購拍立得` : `已關閉 ${nm(p)} 加購拍立得`)
  }
  async function togglePortraitOnly(p) {
    const cur = porOf(p), val = !cur
    setOv(o => ({ ...o, [p.id]: { ...o[p.id], portrait_only: val } }))
    const { error } = await supabase.from('profiles').update({ portrait_only: val }).eq('id', p.id)
    if (error) { setOv(o => ({ ...o, [p.id]: { ...o[p.id], portrait_only: cur } })); setMsg('更新失敗：' + error.message); return }
    setMsg(val ? `${nm(p)} 設為肖像畫負責` : `${nm(p)} 取消肖像畫負責`)
  }

  // 獄方管理卡(正方形,一排 6 張):頭像 → 名字 → 編號 → 身分標籤 → 底部狀態徽章;動作收進右上「⋯」。
  // 典獄長金色(#E8B600)點綴、獄卒沿用綠色。狀態徽章即時樂觀寫回 profiles(portrait_only / offers_polaroid)。
  const StaffCard = (p) => {
    const isChief = p.role === 'warden'
    const roleClass = isChief ? 'warden' : 'guard'
    const name = p.game_name ?? p.display_name ?? '（未命名）'
    return (
      <div key={p.id} className={`gc-card${isChief ? ' chief' : ''}`}>
        {isWarden && (
          <CardMenu items={[
            { label: '編輯', onClick: () => onEditMember(p) },
            { label: '核發帳密', onClick: () => setIssueTarget(p) },
            ...(p.account_type === 'warden_created' ? [{ label: '改帳號名', onClick: () => setRenameTarget(p) }] : []),
          ]} />
        )}
        <div className="gc-av">
          {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <span>{name[0] ?? '?'}</span>}
        </div>
        <div className="gc-nm">{name}</div>
        <div className="gc-no">No.{String(p.inmate_no).padStart(4, '0')}</div>
        <span className={`role-tag ${roleClass}`}>{ROLE_LABEL[p.role] ?? '獄卒'}</span>
        {isWarden && (
          <div className="gc-badges">
            <button type="button" className={`gc-badge${porOf(p) ? ' on' : ''}`}
              onClick={() => togglePortraitOnly(p)}>肖像</button>
            {/* 肖像畫負責時不提供加購拍立得(沿用原欄位連動邏輯) */}
            {!porOf(p) && (
              <button type="button" className={`gc-badge${polOf(p) ? ' on' : ''}`}
                onClick={() => toggleOffersPolaroid(p)}>拍立得</button>
            )}
          </div>
        )}
      </div>
    )
  }

  // 已配號卡片(犯人區):頭貼 + 暱稱 + 編號 + 角色標籤 + 動作(編輯 / 核發帳密 / 改帳號名)
  const MemberCard = (p) => {
    const name = p.game_name ?? p.display_name ?? '（未命名）'
    return (
      <div key={p.id} className="ov-card">
        <div className="ov-av">
          {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <span>{name[0] ?? '?'}</span>}
        </div>
        <div className="ov-nm">{name}</div>
        <div className="ov-no">No.{String(p.inmate_no).padStart(4, '0')}</div>
        <span className={`role-tag ${p.role === 'member' ? 'member' : p.role}`}>{ROLE_LABEL[p.role] ?? '犯人'}</span>
        {isWarden && (
          <div className="ov-acts">
            <button className="btn-sm" onClick={() => onEditMember(p)}>編輯</button>
            {/* 核發帳密:未核發者首發;已核發者重發(新帳號名+新密碼直接蓋過舊的) */}
            <button className="btn-sm" onClick={() => setIssueTarget(p)}>核發帳密</button>
            {p.account_type === 'warden_created' && (
              <button className="btn-sm" onClick={() => setRenameTarget(p)}>改帳號名</button>
            )}
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
      </div>

      {/* 收監登記(代開帳號):僅 warden */}
      {isWarden && <CreateAccountSection reloadShared={reloadShared} />}

      {loading ? <p className="empty">載入中…</p>
        : inmates.length === 0 ? <p className="empty">名單還沒有任何人</p>
          : (<>
            {/* 1) 獄卒區(role in guard/warden,綠框點綴) */}
            {staff.length > 0 && (
              <section className="ov-group">
                <div className="subgroup mine">獄方 ({staff.length})<span className="ln" /></div>
                <div className="gc-grid">{staff.map(StaffCard)}</div>
              </section>
            )}

            {/* 2) 犯人區(role = member) */}
            <section className="ov-group">
              <div className="subgroup">犯人 ({members.length})<span className="ln" /></div>
              {members.length === 0 ? <p className="empty">{ql ? '沒有符合的犯人' : '尚無已配號犯人'}</p>
                : <div className="ov-grid">{members.map(MemberCard)}</div>}
            </section>
          </>)}

      {isWarden && renameTarget && (
        <RenameAccountModal member={renameTarget} setMsg={setMsg} onClose={() => setRenameTarget(null)} />
      )}
      {isWarden && issueTarget && (
        <IssueCredentialsModal member={issueTarget} reloadShared={reloadShared} onClose={() => setIssueTarget(null)} />
      )}
    </div>
  )
}
