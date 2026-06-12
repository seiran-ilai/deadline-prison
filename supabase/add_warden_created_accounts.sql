-- 典獄長代開帳號(feature/warden-create-account):
--   1) profiles.account_type:標記帳號來源('warden_created' = 典獄長代開;null = 一般註冊)。
--      典獄長後台名單以此欄位決定是否顯示「重設密碼／修改帳號名」操作。
--   2) admin_create_profile RPC:由 /api/admin-create-account 以 service_role 呼叫。
--      不走前端直接 insert 的原因:發號必須沿用 claim_profile 同一條路徑
--      (nextval('public.inmate_no_seq')),確保代開帳號與一般新用戶編號流程一致。
--      僅授權 service_role;anon / authenticated 不可呼叫。
-- ⚠️ 需在部署前於 Supabase SQL Editor 執行一次。

begin;

alter table public.profiles add column if not exists account_type text;

create or replace function public.admin_create_profile(p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, discord_account, role, account_type, inmate_no)
  values (p_user_id, p_display_name, '/default-avatar.svg', null, 'member', 'warden_created',
          nextval('public.inmate_no_seq'));
end;
$$;

revoke execute on function public.admin_create_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_profile(uuid, text) to service_role;

commit;
