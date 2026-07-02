-- 放寬自助入場:報名後(有未取消預約)即可自助建立本場身分,不必等「開始入場/服刑」。
-- 手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
--
-- 背景:移除「開始入場(intake)」對外流程後,犯人報名完就能進「犯人服刑」頁挑本場目標;
--   SessionGoals 頁會呼叫 self_check_in 自助建立 session_inmates 列,原本限 intake/serving 才放行,
--   這裡放寬為「場次未結束」皆可(booking / booking_paused / intake / serving / open)。
-- 與 revert 觸發器的互動:典獄長「退回預約中」(intake→booking)會清掉 inmate 名單,
--   但有預約者下次打開犯人服刑頁(≤10 秒輪詢)會再自助入場;本場目標(session_goals)隨名單清除,
--   預排任務(booking_goals)原始資料仍在,重新「開始服刑」時 materialize 會再帶入。

create or replace function public.self_check_in(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings b
    where b.session_id = p_session and b.user_id = auth.uid() and b.status <> 'cancelled'
  ) then
    return;   -- 沒有未取消預約 → 不自助入場
  end if;
  if not exists (
    select 1 from public.sessions s where s.id = p_session and s.status not in ('ended', 'closed')
  ) then
    return;   -- 場次已結束 → 不自助入場
  end if;
  insert into public.session_inmates (session_id, member_id, role_in_session)
  values (p_session, auth.uid(), 'inmate')
  on conflict (session_id, member_id) do nothing;
end;
$$;
grant execute on function public.self_check_in(uuid) to authenticated;
