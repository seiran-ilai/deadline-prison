-- 進行中場次「獄卒作業」要顯示本場犯人的:購買項目(POS)與預約內容(bookings)。
-- 但 pos_order_items / bookings 的 RLS 僅限本人或典獄長,獄卒讀不到別人的 → 以 security definer RPC 兜底,
-- 僅限「本場上班獄卒(session_guards)或典獄長」可讀。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。

-- 本場所有 POS 品項(附本單犯人 customer_name 供前端對名字比對到犯人)
create or replace function public.session_pos_items(p_session uuid)
returns table (
  session_id     uuid,
  customer_name  text,
  person_name    text,
  item_type      text,
  qty            integer,
  with_signature boolean,
  slot_times     jsonb,
  amount         integer,
  guard_id       uuid,
  guard_name     text,
  visitor_name   text
)
language sql
stable security definer
set search_path = public
as $$
  select i.session_id, o.customer_name, i.person_name, i.item_type,
         i.qty, i.with_signature, i.slot_times, i.amount,
         i.target_guard_id, coalesce(g.game_name, g.display_name) as guard_name, i.visitor_name
  from public.pos_order_items i
  join public.pos_orders o on o.id = i.order_id
  left join public.profiles g on g.id = i.target_guard_id
  where i.session_id = p_session
    and (public.is_warden() or exists (
      select 1 from public.session_guards sg
      where sg.session_id = p_session and sg.guard_id = auth.uid()
    ))
$$;
grant execute on function public.session_pos_items(uuid) to authenticated;

-- 本場所有未取消預約的預約內容(指名時段 / 加購 / 抓捕),依 user_id 對應到犯人
create or replace function public.session_bookings_view(p_session uuid)
returns table (
  user_id         uuid,
  status          text,
  requested_slots jsonb,
  addons          jsonb,
  capture         jsonb
)
language sql
stable security definer
set search_path = public
as $$
  select b.user_id, b.status, b.requested_slots, b.addons, b.capture
  from public.bookings b
  where b.session_id = p_session
    and (public.is_warden() or exists (
      select 1 from public.session_guards sg
      where sg.session_id = p_session and sg.guard_id = auth.uid()
    ))
$$;
grant execute on function public.session_bookings_view(uuid) to authenticated;

-- 看守紀錄:讓「獄卒本人」讀自己被指名/拍立得等 POS 服務(target_guard_id = 本人),跨場次彙總用。
create or replace function public.my_guard_items()
returns table (
  session_id     uuid,
  item_type      text,
  qty            integer,
  with_signature boolean,
  slot_times     jsonb,
  amount         integer
)
language sql
stable security definer
set search_path = public
as $$
  select i.session_id, i.item_type, i.qty, i.with_signature, i.slot_times, i.amount
  from public.pos_order_items i
  where i.target_guard_id = auth.uid()
$$;
grant execute on function public.my_guard_items() to authenticated;
