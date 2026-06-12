import { useState } from 'react'
import { adminCreateAccount, adminRenameAccount, adminIssueCredentials, zhAdminError } from '../adminAccountApi'

// 典獄長代開帳號 UI(僅 warden 會被容器渲染):
//   CreateAccountSection   — 名單總覽頂部的「收監登記」區塊(開立帳號)
//   RenameAccountModal     — 名單卡片「修改帳號名」
//   IssueCredentialsModal  — 名單卡片「核發帳密」:為既有用戶設定帳號+密碼(uuid 不變);
//                            可重複核發,新帳密直接蓋過舊的(忘記密碼走這裡)
// 密碼只存在 API 回應與這裡的 state,關掉 modal 即消失,不落任何 log。

const ACCOUNT_RE = /^[a-z0-9_]{3,20}$/

// 前端輔助用隨機密碼(與 api/_lib/wardenAuth.js 同字元集:排除易混淆 0O1lI);
// 僅供「核發帳密」表單一鍵填入,實際送出仍由典獄長確認/可改
function suggestPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(buf, n => chars[n % chars.length]).join('')
}

// 一次性密碼卡:背景點擊不關閉(避免誤關漏抄),須按「我已轉交」
function PasswordModal({ title, account, password, onClose, note = '本人首次登入會被要求設定新密碼。' }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(`帳號：${account}\n預設密碼：${password}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="admin-modal-bg">
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        <label>帳號名
          <input readOnly value={account} onFocus={e => e.target.select()} />
        </label>
        <label>預設密碼
          <input readOnly value={password} onFocus={e => e.target.select()} style={{ fontFamily: 'monospace' }} />
        </label>
        <p className="warn">⚠️ 密碼僅顯示這一次，請立即透過私訊轉交給本人。{note}</p>
        <div className="modal-acts">
          <button onClick={copy}>{copied ? '已複製 ✓' : '複製帳密'}</button>
          <button className="btn-pri" onClick={onClose}>我已轉交，關閉</button>
        </div>
      </div>
    </div>
  )
}

// 收監登記:帳號名 + 獄中名號 → 開立帳號 → 一次性密碼卡
export function CreateAccountSection({ reloadShared }) {
  const [account, setAccount] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)   // { account, password }

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const acc = account.trim().toLowerCase()
    const nm = name.trim()
    if (!ACCOUNT_RE.test(acc)) { setErr(zhAdminError('invalid_account')); return }
    if (nm.length < 2 || nm.length > 20) { setErr(zhAdminError('invalid_display_name')); return }
    setBusy(true)
    const r = await adminCreateAccount(acc, nm)
    setBusy(false)
    if (!r.ok) { setErr(zhAdminError(r.error)); return }
    setResult({ account: r.account, password: r.password })
    setAccount(''); setName('')
    reloadShared?.()
  }

  return (
    <section className="ov-group">
      <div className="subgroup mine">收監登記（代開帳號）<span className="ln" /></div>
      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input className="inp" placeholder="帳號名（a-z 0-9 _，3–20 字）" value={account}
          maxLength={20} autoComplete="off" onChange={e => setAccount(e.target.value)} />
        <input className="inp" placeholder="獄中名號（2–20 字）" value={name}
          maxLength={20} autoComplete="off" onChange={e => setName(e.target.value)} />
        <button className="btn-pri" type="submit" disabled={busy}>{busy ? '開立中…' : '開立帳號'}</button>
      </form>
      <p className="empty" style={{ margin: '6px 0 0' }}>
        系統會產生一次性預設密碼；本人以「帳號名＋密碼」登入，首次登入須改密碼。
      </p>
      {err && <p className="warn">{err}</p>}
      {result && (
        <PasswordModal title="帳號已開立" account={result.account} password={result.password}
          onClose={() => setResult(null)} />
      )}
    </section>
  )
}

// 核發帳密:為既有用戶(Discord 或信箱註冊)設定登入帳號+密碼(原帳號 uuid 不變,編號/紀錄不動)。
// 帳號名預填自 Discord 帳號(過濾為合法字元),密碼由典獄長自訂(可一鍵隨機產生);
// 本人拿到帳密登入後,可在個人資料頁自行修改帳號與密碼,不強制首登改密。
export function IssueCredentialsModal({ member, onClose, reloadShared }) {
  const suggested = (member.discord_account ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const [account, setAccount] = useState(suggested)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)   // { account, password }
  const name = member.game_name ?? member.display_name ?? '（未命名）'

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const acc = account.trim().toLowerCase()
    if (!ACCOUNT_RE.test(acc)) { setErr(zhAdminError('invalid_account')); return }
    if (password.length < 8) { setErr('密碼至少需 8 碼'); return }
    setBusy(true)
    const r = await adminIssueCredentials(member.id, acc, password)
    setBusy(false)
    if (!r.ok) { setErr(zhAdminError(r.error)); return }
    setResult({ account: r.account, password: r.password })
    reloadShared?.()
  }

  if (result) {
    return <PasswordModal title="帳號密碼已核發" account={result.account} password={result.password}
      note="本人登入後可在個人資料頁自行修改帳號密碼。" onClose={onClose} />
  }
  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>{member.account_type === 'warden_created' ? '重新核發帳號密碼' : '核發帳號密碼'}</h3>
        <p>為「{name}」設定登入帳號與密碼。核發後本人以「帳號＋密碼」登入，編號、名號與所有紀錄不變；登入後可在個人資料頁自行修改帳號密碼。</p>
        {member.account_type === 'warden_created' && (
          <p className="warn">此成員已核發過帳密：本次將以新帳號＋新密碼直接蓋過，舊密碼立即失效。</p>
        )}
        <form onSubmit={submit}>
          <label>帳號名
            <input value={account} maxLength={20} autoComplete="off" autoFocus
              placeholder="a-z 0-9 _，3–20 字" onChange={e => setAccount(e.target.value)} />
          </label>
          <label>登入密碼（至少 8 碼）
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={password} maxLength={72} autoComplete="off" style={{ flex: 1, fontFamily: 'monospace' }}
                placeholder="自訂或按右側隨機產生" onChange={e => setPassword(e.target.value)} />
              <button type="button" className="btn-sm" onClick={() => setPassword(suggestPassword())}>隨機產生</button>
            </div>
          </label>
          {err && <p className="warn">{err}</p>}
          <div className="modal-acts">
            <button type="button" onClick={onClose}>取消</button>
            <button className="btn-pri" type="submit" disabled={busy}>{busy ? '核發中…' : '確認核發'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// 修改帳號名:輸入新帳號名 → 呼叫 API → 成功提示由容器 setMsg 顯示
export function RenameAccountModal({ member, onClose, setMsg }) {
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const name = member.game_name ?? member.display_name ?? '（未命名）'

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const acc = account.trim().toLowerCase()
    if (!ACCOUNT_RE.test(acc)) { setErr(zhAdminError('invalid_account')); return }
    setBusy(true)
    const r = await adminRenameAccount(member.id, acc)
    setBusy(false)
    if (!r.ok) { setErr(zhAdminError(r.error)); return }
    setMsg(`已將「${name}」更名為「${r.account}」，請通知本人改用新帳號登入`)
    onClose()
  }

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>修改帳號名</h3>
        <p>為「{name}」設定新帳號名。改名不影響編號、名號與任何紀錄。</p>
        <form onSubmit={submit}>
          <label>新帳號名
            <input value={account} maxLength={20} autoComplete="off" autoFocus
              placeholder="a-z 0-9 _，3–20 字" onChange={e => setAccount(e.target.value)} />
          </label>
          {err && <p className="warn">{err}</p>}
          <div className="modal-acts">
            <button type="button" onClick={onClose}>取消</button>
            <button className="btn-pri" type="submit" disabled={busy}>{busy ? '更名中…' : '確認更名'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
