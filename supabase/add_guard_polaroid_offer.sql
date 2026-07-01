-- 每位「當日上班」獄卒可設定是否提供加購拍立得。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- session_guards 加 offers_polaroid(預設 true);session_named_slots 一併回傳,官網預約據此決定是否顯示該卒的拍立得/簽繪加購。

alter table public.session_guards
  add column if not exists offers_polaroid boolean not null default true;

-- 回傳欄位新增 offers_polaroid → 需先 drop 再 create(不能用 CREATE OR REPLACE 改回傳型別)
drop function if exists public.session_named_slots(uuid);

create function public.session_named_slots(p_session uuid)
 returns table(guard_id uuid, game_name text, display_name text, avatar_url text,
               slot_index smallint, slot_label text, taken boolean, offers_polaroid boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with se as (select id, kind, start_time from sessions where id = p_session)
  -- 指名互動場:每位上班獄卒的每個可指名時格
  select p.id, p.game_name, p.display_name, p.avatar_url,
         s.slot_idx::smallint as slot_index,
         case when se.start_time is not null
              then to_char(se.start_time + (s.slot_idx * interval '30 minutes'), 'HH24:MI')
              else null end as slot_label,
         exists (
           select 1 from bookings b
           where b.session_id = p_session and b.status <> 'cancelled'
             and b.requested_slots @> jsonb_build_array(jsonb_build_object('g', p.id::text, 's', s.slot_idx))
         ) as taken,
         sg.offers_polaroid
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  cross join lateral unnest(sg.slots) as s(slot_idx)
  where sg.session_id = p_session and se.kind = 'named'
  union all
  -- 集體趕稿場:每位上班獄卒一列(無時格),taken = 是否已被指定監督
  select p.id, p.game_name, p.display_name, p.avatar_url,
         null::smallint as slot_index,
         null::text as slot_label,
         exists (
           select 1 from bookings b
           where b.session_id = p_session and b.status <> 'cancelled'
             and b.requested_slots @> jsonb_build_array(jsonb_build_object('g', p.id::text, 's', null))
         ) as taken,
         sg.offers_polaroid
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  where sg.session_id = p_session and se.kind = 'crunch'
  order by 2 nulls last, 3 nulls last, 5 nulls last
$function$;

grant execute on function public.session_named_slots(uuid) to anon, authenticated;
