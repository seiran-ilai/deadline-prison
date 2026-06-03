import { supabase } from '../supabaseClient'
import { ROLE_LABEL } from './constants'

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
      setMsg('儲存失敗:' + error.message + '(若是改身分,僅典獄長可變更)')
      return
    }
    const roleChanged = m.role !== m._origRole
    setMsg(roleChanged
      ? `已儲存。已將身分變更為「${ROLE_LABEL[m.role] ?? m.role}」,該使用者需「重新登入」才會生效`
      : '已儲存犯人資料')
    setMember(null)
    reloadShared()
  }

  return (
    <div onClick={() => setMember(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', color: '#222', borderRadius: 8, padding: 24, width: 360, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <strong style={{ fontSize: 16 }}>編輯犯人資料</strong>
        <label>遊戲暱稱
          <input style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }}
            value={member.game_name} onChange={e => setMember({ ...member, game_name: e.target.value })} />
        </label>
        <label>頭貼網址
          <input style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }}
            value={member.avatar_url} onChange={e => setMember({ ...member, avatar_url: e.target.value })} />
        </label>
        <label>Discord 帳號
          <input style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }}
            value={member.discord_account} onChange={e => setMember({ ...member, discord_account: e.target.value })} />
        </label>
        <label>身分 role
          <select style={{ width: '100%', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', color: '#222' }}
            value={member.role} onChange={e => setMember({ ...member, role: e.target.value })}>
            <option value="member">犯人</option>
            <option value="guard">獄卒</option>
            <option value="warden">典獄長</option>
          </select>
        </label>
        {member.role !== member._origRole && (
          <p style={{ color: '#c60', fontSize: 13, margin: 0 }}>⚠️ 變更身分後,該使用者需重新登入才會生效</p>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button style={{ padding: '6px 12px', border: '1px solid #bbb', borderRadius: 4, background: '#fafafa', color: '#333', cursor: 'pointer' }}
            onClick={() => setMember(null)}>取消</button>
          <button style={{ padding: '6px 12px', border: '1px solid #bbb', borderRadius: 4, background: '#eef4ff', color: '#333', cursor: 'pointer' }}
            onClick={saveMember}>儲存</button>
        </div>
      </div>
    </div>
  )
}
