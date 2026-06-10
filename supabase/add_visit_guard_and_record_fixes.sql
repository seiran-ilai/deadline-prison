-- 探監指定獄卒 + 服刑紀錄統計修正 + 取消預約同步移出場次。
-- 整段貼進 Supabase SQL Editor 執行一次即可。
--
-- 內容:
--   1) visits 加 guard_id(探監除了指定犯人,也記錄指定獄卒;可空 = 不指定)
--   2) visits 讀取權限:本人 + 同場參與者可讀(犯人服刑/獄卒作業頁的「本場廣播」、
--      服刑紀錄的「過去廣播紀錄」都需要;additive policy,不動既有 policy)
--   3) my_record_summary 重寫:入監次數/累計輪數改以 session_inmates 計
--      (修正「典獄長直接報到入場、沒走預約」的場次不被計入的問題)
--   4) 取消預約 → 同步把本人移出該場 session_inmates(僅未開始服刑的場次),
--      並一次性清掉既有的「已取消預約卻還掛在場上」殘留列

-- 1) visits 指定獄卒 ───────────────────────────────────────────
alter table visits add column if not exists guard_id uuid references profiles(id) on delete set null;

-- 2) visits 讀取:本人(被探監者)+ 同場參與者 ─────────────────────
-- additive:多一條 permissive policy 放寬讀取,不影響既有 staff 寫入/讀取 policy。
drop policy if exists visits_select_participants on visits;
create policy visits_select_participants on visits
  for select using (
    inmate_id = auth.uid()
    or exists (
      select 1 from session_inmates si
      where si.session_id = visits.session_id and si.member_id = auth.uid()
    )
  );

-- 3) my_record_summary 重寫 ────────────────────────────────────
-- 入監次數 / 累計輪數:已結束場次中,我以 role_in_session='inmate' 在場的列(不再依賴 bookings,
-- 典獄長手動報到的場次也會計入)。看守次數:已結束場次中 role_in_session='guard' 的列。
-- 收到探監:visits.inmate_id = 我(不限場次狀態,與「服刑紀錄」列表顯示一致)。
-- ⚠️ 回傳型別可能與舊版不同,先 drop 再 create(rpc 呼叫端欄位名不變)。
drop function if exists public.my_record_summary();
create function public.my_record_summary()
returns table (intake_count int, total_rounds int, visits_received int, guard_count int)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*)::int
       from session_inmates si join sessions s on s.id = si.session_id
      where si.member_id = auth.uid()
        and si.role_in_session = 'inmate'
        and s.status in ('ended', 'closed')) as intake_count,
    (select coalesce(sum(s.total_rounds), 0)::int
       from session_inmates si join sessions s on s.id = si.session_id
      where si.member_id = auth.uid()
        and si.role_in_session = 'inmate'
        and s.status in ('ended', 'closed')) as total_rounds,
    (select count(*)::int from visits v where v.inmate_id = auth.uid()) as visits_received,
    (select count(*)::int
       from session_inmates si join sessions s on s.id = si.session_id
      where si.member_id = auth.uid()
        and si.role_in_session = 'guard'
        and s.status in ('ended', 'closed')) as guard_count
$$;

grant execute on function public.my_record_summary() to authenticated;

-- 4) 取消預約 → 移出場次 ───────────────────────────────────────
-- 場次「開始入場」會把預約者帶進 session_inmates;之後本人取消預約時,這列要跟著移除,
-- 否則會留下「沒參加卻有服刑紀錄」的殘留(僅處理尚未開始服刑的場次:
-- booking / booking_paused / intake,以及過渡期舊值 open 且計時未開始)。
create or replace function public.on_booking_cancelled_remove_inmate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from session_inmates si
    using sessions s
    where s.id = si.session_id
      and si.session_id = new.session_id
      and si.member_id = new.user_id
      and si.role_in_session = 'inmate'
      and (s.status in ('booking', 'booking_paused', 'intake')
           or (s.status = 'open' and s.timer_started_at is null));
  end if;
  return new;
end;
$$;

drop trigger if exists booking_cancelled_remove_inmate on bookings;
create trigger booking_cancelled_remove_inmate
  after update on bookings
  for each row execute function public.on_booking_cancelled_remove_inmate();

-- 一次性清掉既有殘留:已取消預約、卻仍掛在「尚未開始服刑」場上的犯人列
delete from session_inmates si
using sessions s, bookings b
where s.id = si.session_id
  and b.session_id = si.session_id
  and b.user_id = si.member_id
  and b.status = 'cancelled'
  and si.role_in_session = 'inmate'
  and (s.status in ('booking', 'booking_paused', 'intake')
       or (s.status = 'open' and s.timer_started_at is null));
