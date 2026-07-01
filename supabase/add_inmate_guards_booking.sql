-- 專屬看守支援「走查預約(匿名臨時報名)」:inmate_guards 除了綁 session_inmates,也能綁 bookings。
-- 手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- 背景:臨時報名建的是 bookings(user_id=null 的走查列),不是 session_inmates;
--       原 inmate_guards 只綁 session_inmate_id,故走查犯人無法被指派專屬看守。此檔加 booking_id。

-- 1) 新增可空 booking_id;原 session_inmate_id 放寬為可空(兩者二擇一)
alter table public.inmate_guards
  add column if not exists booking_id uuid references public.bookings(id) on delete cascade;
alter table public.inmate_guards
  alter column session_inmate_id drop not null;

-- 2) 走查犯人同一獄卒不重複指派(部分唯一索引)
create unique index if not exists inmate_guards_booking_guard_uniq
  on public.inmate_guards (booking_id, guard_id) where booking_id is not null;

-- 3) RLS:沿用既有「典獄長全權」policy(is_warden())即可管理 booking 型指派;
--    若你的 inmate_guards 沒有 warden 全權 policy,取消下面註解補上(冪等):
-- alter table public.inmate_guards enable row level security;
-- drop policy if exists inmate_guards_warden_all on public.inmate_guards;
-- create policy inmate_guards_warden_all on public.inmate_guards
--   for all using (public.is_warden()) with check (public.is_warden());

-- 4) 獄卒端「我看守的走查犯人」:獄卒讀不到匿名走查 bookings(RLS),
--    以 SECURITY DEFINER 回傳「指派給我(auth.uid())的走查犯人」供獄卒作業顯示。
create or replace function public.session_my_ward_bookings(p_session uuid)
returns table (booking_id uuid, game_name text, avatar_url text)
language sql
stable security definer
set search_path = public
as $$
  select b.id, b.game_name, b.avatar_url
  from public.inmate_guards ig
  join public.bookings b on b.id = ig.booking_id
  where ig.guard_id = auth.uid()
    and b.session_id = p_session
    and b.status <> 'cancelled'
$$;
grant execute on function public.session_my_ward_bookings(uuid) to authenticated;
