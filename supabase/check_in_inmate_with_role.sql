-- 目的:讓報到「一次原子寫入」本場身分,取代前端「rpc 報到 + 再 update role_in_session」兩段。
-- 作法:check_in_inmate 新增第三參數 p_role_in_session(預設 'inmate'),insert 時一併寫入。
--
-- ⚠️ 必須先 drop 舊的 2 參數版:
--   create or replace 不會取代不同簽名的函式(會變成 overload);
--   保留舊 2 參數版會與「帶預設值的 3 參數版」在呼叫時造成歧義。
--
-- 用法:整段貼進 Supabase SQL Editor 執行一次。執行後請務必同步更新前端(已改成傳 3 參數)。

drop function if exists public.check_in_inmate(uuid, uuid);

create or replace function public.check_in_inmate(
  p_session uuid,
  p_member uuid,
  p_role_in_session text default 'inmate'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_staff() then raise exception '只有管理者能報到'; end if;
  -- 防呆:本場身分只允許 inmate / guard
  if p_role_in_session not in ('inmate', 'guard') then
    raise exception '無效的本場身分: %', p_role_in_session;
  end if;
  -- 先把他從其他「進行中」場次移除(確保一人只在一場)
  delete from public.session_inmates si
  using public.sessions s
  where si.member_id = p_member
    and si.session_id = s.id
    and s.status = 'open';
  -- 報到進目前場次,一次寫入本場身分;若重複報到同場則更新身分
  insert into public.session_inmates (session_id, member_id, role_in_session)
  values (p_session, p_member, p_role_in_session)
  on conflict (session_id, member_id) do update
    set role_in_session = excluded.role_in_session;
end;
$function$;
