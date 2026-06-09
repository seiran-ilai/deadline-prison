import { supabase } from '../supabaseClient'
import { ROLE_LABEL } from './constants'
import AvatarInput from '../AvatarInput'

// 編輯犯人資料 modal(僅 warden 會被容器渲染)
export default function EditMemberModal({ member, setMember, setMsg, reloadShared }) {
  async function saveMember() {
    const m = member
    const { error } = await supabase.from('profiles').update({
      game_name: m.game_name || null,
      avatar_url: m.avatar_url || null,
      discord_account: m.discord_account || null,
      role: m.role,
    }).eq('id', m.id)
    if (error) {
      // 觸發器 protect_role_column:非 warden 改 role 會在這裡被擋
      setMsg('儲存失敗：' + error.message + '（若是改身分，僅典獄長可變更）')
      return
    }
    // 編號變動才另外呼叫 set_inmate_no(走唯一索引;撞號時 RPC raise,把訊息顯示在錯誤 banner)。
    // 兩個呼叫都成功才視為儲存完成(此處 set_inmate_no 失敗則不關閉 modal,讓使用者改號重試)。
    const origNo = m._origNo == null ? null : Number(m._origNo)
    const raw = String(m.inmate_no ?? '').trim()
    const newNo = raw === '' ? null : Number(raw)
    if (newNo !== origNo) {
      if (newNo == null || !Number.isInteger(newNo) || newNo <= 0) {
        setMsg('儲存失敗：編號需為正整數')
        return
      }
      const { error: noErr } = await supabase.rpc('set_inmate_no', { target_id: m.id, new_no: newNo })
      if (noErr) { setMsg('儲存失敗：' + noErr.message); return }
    }
    const roleChanged = m.role !== m._origRole
    setMsg(roleChanged
      ? `已儲存。已將身分變更為「${ROLE_LABEL[m.role] ?? m.role}」，該使用者需「重新登入」才會生效`
      : '已儲存犯人資料')
    setMember(null)
    reloadShared()
  }

  return (
    <div className="admin-modal-bg" onClick={() => setMember(null)}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <h3>編輯犯人資料</h3>
        <label>編號 No.
          <input type="number" min="1" value={member.inmate_no}
            onChange={e => setMember({ ...member, inmate_no: e.target.value })} />
        </label>
        <label>遊戲暱稱
          <input value={member.game_name} onChange={e => setMember({ ...member, game_name: e.target.value })} />
        </label>
        <div className="field">
          <span className="field-lbl">頭像</span>
          <AvatarInput value={member.avatar_url} onChange={url => setMember({ ...member, avatar_url: url })} userId={member.id} />
        </div>
        <label>Discord 帳號
          <input value={member.discord_account} onChange={e => setMember({ ...member, discord_account: e.target.value })} />
        </label>
        <label>身分 role
          <select value={member.role} onChange={e => setMember({ ...member, role: e.target.value })}>
            <option value="member">犯人</option>
            <option value="guard">獄卒</option>
            <option value="warden">典獄長</option>
          </select>
        </label>
        {member.role !== member._origRole && (
          <p className="warn">⚠️ 變更身分後，該使用者需重新登入才會生效</p>
        )}
        <div className="modal-acts">
          <button onClick={() => setMember(null)}>取消</button>
          <button className="btn-pri" onClick={saveMember}>儲存</button>
        </div>
      </div>
    </div>
  )
}
