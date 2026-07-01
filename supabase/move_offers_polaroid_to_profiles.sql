-- 「可加購拍立得」改為獄卒的全域設定(profiles),不再每場勾選。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- profiles 加 offers_polaroid(預設 true);session_named_slots 改由 profiles 回傳(不再讀 session_guards)。
-- 名單總覽 > 獄卒名單 直接設定;session_guards.offers_polaroid 欄位保留不影響(不再使用)。

alter table public.profiles
  add column if not exists offers_polaroid boolean not null default true;

-- 回傳型別不變(仍含 offers_polaroid),來源改為 profiles → 可用 CREATE OR REPLACE
create or replace function public.session_named_slots(p_session uuid)
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
         p.offers_polaroid
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
         p.offers_polaroid
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  where sg.session_id = p_session and se.kind = 'crunch'
  order by 2 nulls last, 3 nulls last, 5 nulls last
$function$;

grant execute on function public.session_named_slots(uuid) to anon, authenticated;
