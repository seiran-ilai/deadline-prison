-- 兩件事,手動貼進 Supabase SQL Editor 跑一次(可重複安全執行):
--   1) 自助入場:場次一旦開始入場(intake/serving),有未取消預約的犯人本人即可自助建立本場身分,免典獄長「報到/身分核對」。
--   2) 獄卒可勾選 POS 核對項(互動/合照/拍立得),與典獄長「今日營業總表」同一筆資料同步。

-- 1) 自助入場:僅限本人、有未取消預約、且場次已開始入場
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
    select 1 from public.sessions s where s.id = p_session and s.status in ('intake', 'serving', 'open')
  ) then
    return;   -- 場次尚未開始入場 → 不自助入場
  end if;
  insert into public.session_inmates (session_id, member_id, role_in_session)
  values (p_session, auth.uid(), 'inmate')
  on conflict (session_id, member_id) do nothing;
end;
$$;
grant execute on function public.self_check_in(uuid) to authenticated;

-- 2a) 重建 session_pos_items:多回傳 id 與核對狀態(供獄卒作業勾選)
drop function if exists public.session_pos_items(uuid);
create or replace function public.session_pos_items(p_session uuid)
returns table (
  id              uuid,
  session_id      uuid,
  customer_name   text,
  person_name     text,
  item_type       text,
  qty             integer,
  with_signature  boolean,
  slot_times      jsonb,
  amount          integer,
  guard_id        uuid,
  guard_name      text,
  visitor_name    text,
  status_interact boolean,
  status_photo    boolean,
  status_polaroid boolean
)
language sql
stable security definer
set search_path = public
as $$
  select i.id, i.session_id, o.customer_name, i.person_name, i.item_type,
         i.qty, i.with_signature, i.slot_times, i.amount,
         i.target_guard_id, coalesce(g.game_name, g.display_name) as guard_name, i.visitor_name,
         i.status_interact, i.status_photo, i.status_polaroid
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

-- 2b) 獄卒勾選 POS 核對項:限本場上班獄卒 / 該品項對象獄卒 / 典獄長
create or replace function public.set_pos_item_status(p_item uuid, p_field text, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_field not in ('status_interact', 'status_photo', 'status_polaroid') then
    raise exception '無效欄位: %', p_field;
  end if;
  if not (
    public.is_warden()
    or exists (select 1 from public.pos_order_items i where i.id = p_item and i.target_guard_id = auth.uid())
    or exists (
      select 1 from public.pos_order_items i
      join public.session_guards sg on sg.session_id = i.session_id and sg.guard_id = auth.uid()
      where i.id = p_item)
  ) then
    raise exception '無權限勾選此項';
  end if;
  execute format('update public.pos_order_items set %I = $1 where id = $2', p_field) using p_value, p_item;
end;
$$;
grant execute on function public.set_pos_item_status(uuid, text, boolean) to authenticated;
