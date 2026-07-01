-- 服刑紀錄儀表板:讓「犯人本人」讀到自己在指名互動場的加購品項與明細。
-- pos_order_items 的 RLS 僅限 is_warden(),犯人本身讀不到;改由 security definer RPC 依「本人暱稱」比對回傳。
-- 比對鍵:pos_order_items.person_name 或該訂單 pos_orders.customer_name = 本人 game_name / display_name。
-- 手動貼進 Supabase SQL Editor 跑一次即可(可重複安全執行)。金額單位「萬」。
create or replace function public.my_pos_items()
returns table (
  session_id      uuid,
  item_type       text,
  person_name     text,
  qty             integer,
  with_signature  boolean,
  slot_times      jsonb,
  amount          integer,
  guard_name      text,
  visitor_name    text
)
language sql
security definer
set search_path = public
as $$
  with me as (
    select game_name, display_name from public.profiles where id = auth.uid()
  )
  select i.session_id, i.item_type, i.person_name, i.qty, i.with_signature,
         i.slot_times, i.amount,
         coalesce(g.game_name, g.display_name) as guard_name, i.visitor_name
  from public.pos_order_items i
  join public.pos_orders o on o.id = i.order_id
  cross join me
  left join public.profiles g on g.id = i.target_guard_id
  where nullif(me.game_name, '')    is not null and i.person_name   = me.game_name
     or nullif(me.display_name, '') is not null and i.person_name   = me.display_name
     or nullif(me.game_name, '')    is not null and o.customer_name = me.game_name
     or nullif(me.display_name, '') is not null and o.customer_name = me.display_name
$$;

grant execute on function public.my_pos_items() to authenticated;
