import { useState } from 'react'
import { adminCreateAccount, adminResetPassword, adminRenameAccount, adminIssueCredentials, zhAdminError } from '../adminAccountApi'

// 典獄長代開帳號 UI(僅 warden 會被容器渲染):
//   CreateAccountSection   — 名單總覽頂部的「收監登記」區塊(開立帳號)
//   ResetPasswordModal     — 名單卡片「重設密碼」(確認 → 一次性密碼卡)
//   RenameAccountModal     — 名單卡片「修改帳號名」
//   IssueCredentialsModal  — 名單卡片「核發帳密」:為既有 Discord 用戶補帳號+密碼(uuid 不變)
// 密碼只存在 API 回應與這裡的 state,關掉 modal 即消失,不落任何 log。

const ACCOUNT_RE = /^[a-z0-9_]{3,20}$/

// 一次性密碼卡:背景點擊不關閉(避免誤關漏抄),須按「我已轉交」
function PasswordModal({ title, account, password, onClose }) {
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
        <p className="warn">⚠️ 密碼僅顯示這一次，請立即透過私訊轉交給本人。本人首次登入會被要求設定新密碼。</p>
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

// 重設密碼:確認對話框 → 呼叫 API → 一次性密碼卡
export function ResetPasswordModal({ member, onClose }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)   // { account, password }
  const name = member.game_name ?? member.display_name ?? '（未命名）'

  async function run() {
    setErr(null); setBusy(true)
    const r = await adminResetPassword(member.id)
    setBusy(false)
    if (!r.ok) { setErr(zhAdminError(r.error)); return }
    setResult({ account: r.account, password: r.password })
  }

  if (result) {
    return <PasswordModal title="密碼已重設" account={result.account} password={result.password} onClose={onClose} />
  }
  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>重設密碼</h3>
        <p>確定要重設「{name}」的密碼嗎？</p>
        <p className="warn">舊密碼將立即失效，並產生新的一次性預設密碼；本人下次登入須重新設定密碼。</p>
        {err && <p className="warn">{err}</p>}
        <div className="modal-acts">
          <button onClick={onClose}>取消</button>
          <button className="btn-pri" onClick={run} disabled={busy}>{busy ? '重設中…' : '確認重設'}</button>
        </div>
      </div>
    </div>
  )
}

// 核發帳密:既有 Discord 註冊用戶 → 補帳號名+一次性密碼(原帳號 uuid 不變,編號/紀錄不動)。
// 帳號名預填自 Discord 帳號(過濾為合法字元),典獄長可改;成功後顯示一次性密碼卡。
export function IssueCredentialsModal({ member, onClose, reloadShared }) {
  const suggested = (member.discord_account ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const [account, setAccount] = useState(suggested)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)   // { account, password }
  const name = member.game_name ?? member.display_name ?? '（未命名）'

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const acc = account.trim().toLowerCase()
    if (!ACCOUNT_RE.test(acc)) { setErr(zhAdminError('invalid_account')); return }
    setBusy(true)
    const r = await adminIssueCredentials(member.id, acc)
    setBusy(false)
    if (!r.ok) { setErr(zhAdminError(r.error)); return }
    setResult({ account: r.account, password: r.password })
    reloadShared?.()
  }

  if (result) {
    return <PasswordModal title="帳號密碼已核發" account={result.account} password={result.password} onClose={onClose} />
  }
  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>核發帳號密碼</h3>
        <p>為 Discord 用戶「{name}」核發站內帳號。核發後本人改以「帳號名＋密碼」登入，編號、名號與所有紀錄不變。</p>
        <form onSubmit={submit}>
          <label>帳號名
            <input value={account} maxLength={20} autoComplete="off" autoFocus
              placeholder="a-z 0-9 _，3–20 字" onChange={e => setAccount(e.target.value)} />
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
