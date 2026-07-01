-- POS 走查:典獄長臨時追加犯人 / 臨時報名(建 bookings 走查列)。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- bookings 的 insert RLS 限 user_id = auth.uid(),典獄長無法直接代建 user_id=null 的走查列,
-- 故用 security definer RPC(限 is_warden())。requested_slots 帶指名/監督(named 帶時格、crunch s=null)。

create or replace function public.warden_add_walkin(
  p_session uuid,
  p_name text,
  p_slots jsonb default '[]'::jsonb,
  p_arrived boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare bid uuid;
begin
  if not public.is_warden() then raise exception '只有典獄長能追加走查犯人'; end if;
  insert into public.bookings (session_id, user_id, dc_id, dc_name, game_name, status, requested_slots, arrived)
  values (p_session, null, null, null, nullif(btrim(coalesce(p_name, '')), ''), 'confirmed',
          coalesce(p_slots, '[]'::jsonb), coalesce(p_arrived, true))
  returning id into bid;
  return bid;
end $$;

grant execute on function public.warden_add_walkin(uuid, text, jsonb, boolean) to authenticated;
