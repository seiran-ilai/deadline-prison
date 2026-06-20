-- 退回入場時清掉自動帶入的犯人(option A)。
-- 整段貼進 Supabase SQL Editor 執行一次即可。
--
-- 問題:
--   「開始入場(intake)」會把預約者自動帶進本場名單 session_inmates。
--   之後若把場次「退回預約中 / 退回停止預約」,只改了場次狀態,
--   這些犯人列卻留在名單上。因為「一人同時只能在一場未結束場次」,
--   這些殘留會卡住其他場次的「重新帶入預約名單 / 開始入場」——
--   同時預約兩場的人會被當成「還在別場」而被跳過,載不進來。
--
-- 作法(additive,不動既有 set_session_status / materialize_session_bookings):
--   在 sessions 加一個 AFTER UPDATE OF status 觸發器;當狀態由 intake
--   退回到 booking / booking_paused 時,刪掉本場 role_in_session='inmate' 的列。
--   只清犯人列(獄卒是手動加入,保留);bookings 預約資料完全不動,
--   日後該場正式入場時會再次自動帶入。session_goals 靠既有 cascade 一併清。

-- 1) 觸發器函式 ───────────────────────────────────────────────
create or replace function public.on_session_revert_clear_inmates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('booking', 'booking_paused')
     and old.status = 'intake' then
    delete from public.session_inmates
    where session_id = new.id
      and role_in_session = 'inmate';
  end if;
  return new;
end;
$$;

drop trigger if exists session_revert_clear_inmates on sessions;
create trigger session_revert_clear_inmates
  after update of status on sessions
  for each row execute function public.on_session_revert_clear_inmates();

-- 2) 一次性清理:目前處於「預約中 / 停止預約」卻仍掛著犯人的場次 ─────
--    (這次「不小心讓 d2 開始入場後又退回」留下的殘留;處在這兩種狀態的
--     場次本就不該有犯人在名單上,故安全)。跑完後到「進行中場次」把目前
--     場次切到 d1，按「重新帶入預約名單」即可把同時預約兩場的人帶進 d1。
delete from public.session_inmates si
using public.sessions s
where s.id = si.session_id
  and s.status in ('booking', 'booking_paused')
  and si.role_in_session = 'inmate';
