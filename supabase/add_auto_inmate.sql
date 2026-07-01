-- 匿名犯人自動建檔發號 + 伺服器欄位。
-- 臨時入場 / 只填名字訪客 / 監獄外抓捕的被抓捕者:伺服器端 admin.createUser 建帳號後,
-- 以 create_auto_inmate 建 profiles、發流水編號(共用 inmate_no_seq)、記錄伺服器。
-- profiles.id 為 auth.users(id) 外鍵,故必須先有 auth user;RPC 僅 service_role 可呼叫。
-- 手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。

-- 1) 伺服器欄位(暱稱 / 伺服器分開兩欄)。既有資料一律留空(null)。
alter table public.profiles add column if not exists server text;
alter table public.bookings add column if not exists server text;   -- 走查/訪客預約列的伺服器(顯示 + 帶入 profile)

-- 2) 自動建檔發號(帶伺服器)
create or replace function public.create_auto_inmate(
  p_user_id uuid,
  p_game_name text,
  p_server text default null,
  p_account_type text default 'walkin'   -- walkin(臨時入場)/ guest(只填名字)/ capture(被抓捕)
) returns integer                        -- 回傳發出的流水編號 inmate_no
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  n := nextval('public.inmate_no_seq');
  insert into public.profiles (id, game_name, server, display_name, avatar_url, role, account_type, inmate_no)
  values (p_user_id, nullif(btrim(coalesce(p_game_name, '')), ''), nullif(btrim(coalesce(p_server, '')), ''),
          null, '/default-avatar.svg', 'member', coalesce(p_account_type, 'walkin'), n);
  return n;
end $$;

revoke execute on function public.create_auto_inmate(uuid, text, text, text) from public, anon, authenticated;
grant  execute on function public.create_auto_inmate(uuid, text, text, text) to service_role;
