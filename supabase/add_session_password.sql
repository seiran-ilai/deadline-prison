-- 密鑰場次:公開場次可另設通行密鑰。官網場次卡顯示「密鑰入獄」,
-- 點開後須輸入正確密鑰才能進入報名流程;/api/booking 伺服器端也會再驗一次。
-- 內部場(is_public = false)不適用密鑰(前台本來就看不到)。
-- 整段貼進 Supabase SQL Editor 執行一次即可。
--
-- 注意:public_sessions() 因新增回傳欄位 has_password,改回傳型別需先 drop 再重建。
-- 本檔重建的定義 = 線上現行行為(過濾內部場與已結束場、回傳 display_status / can_book,
-- 正規化與前端 normalizeStatus 一致)+ 新增 has_password。執行後請開官網確認場次列表行為不變。

-- 1) 密鑰表:獨立一表、不加在 sessions 上,RLS 僅典獄長可讀寫;
--    一般登入者即使直接 select sessions / session_passwords 也拿不到密鑰內容。
create table if not exists session_passwords (
  session_id  uuid primary key references sessions(id) on delete cascade,
  password    text not null,
  created_at  timestamptz not null default now()
);

alter table session_passwords enable row level security;

drop policy if exists session_passwords_warden_all on session_passwords;
create policy session_passwords_warden_all on session_passwords
  for all using (is_warden()) with check (is_warden());

-- 2) 密鑰核對(SECURITY DEFINER 繞 RLS;只回對/錯,不外洩密鑰內容)
create or replace function public.check_session_password(p_session uuid, p_password text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from session_passwords
    where session_id = p_session and password = p_password
  )
$$;

grant execute on function public.check_session_password(uuid, text) to anon, authenticated;

-- 3) public_sessions():新增 has_password 欄位
drop function if exists public.public_sessions();
create function public.public_sessions()
returns table (
  id uuid, title text, session_date date, capacity int, booked int,
  display_status text, can_book boolean, has_password boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.title, s.session_date, s.capacity,
         coalesce((
           select count(*) from bookings b
           where b.session_id = s.id and b.status <> 'cancelled'
         ), 0)::int as booked,
         st.v as display_status,
         (st.v = 'booking') as can_book,
         exists (select 1 from session_passwords sp where sp.session_id = s.id) as has_password
  from sessions s
  cross join lateral (
    -- 與前端 normalizeStatus 同步:過渡期舊值 open/closed 先正規化成五態
    select case
      when s.status = 'open' then (case when s.timer_started_at is not null then 'serving' else 'booking' end)
      when s.status = 'closed' then 'ended'
      else s.status
    end as v
  ) st
  where coalesce(s.is_public, true)   -- 內部場不外露
    and st.v <> 'ended'               -- 已結束場不外露
  order by s.session_date nulls last, s.created_at
$$;

grant execute on function public.public_sessions() to anon, authenticated;
