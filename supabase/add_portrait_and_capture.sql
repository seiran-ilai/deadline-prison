-- 肖像畫負責獄卒 + session_named_slots 回傳 portrait_only。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- profiles.portrait_only:此獄卒「只接肖像畫」— 不承接指名互動 / 拍立得 / 集體場互動與指定監督。
--   被勾選且當日上班時,官網預約才開放向該卒購買肖像畫。
-- session_named_slots 改回傳 portrait_only:
--   * 肖像畫負責獄卒:每位上班一列(slot_index=null、taken=false、offers_polaroid=false、portrait_only=true),不出時格/監督列。
--   * 其餘獄卒:named 每時格一列、crunch 每位監督一列(portrait_only=false)。

alter table public.profiles
  add column if not exists portrait_only boolean not null default false,
  add column if not exists offers_polaroid boolean not null default true;   -- 兜底:若尚未跑 move_offers_polaroid_to_profiles.sql

-- 回傳新增 portrait_only 欄 → 需先 drop 再 create
drop function if exists public.session_named_slots(uuid);

create function public.session_named_slots(p_session uuid)
 returns table(guard_id uuid, game_name text, display_name text, avatar_url text,
               slot_index smallint, slot_label text, taken boolean, offers_polaroid boolean, portrait_only boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with se as (select id, kind, start_time from sessions where id = p_session)
  -- 肖像畫負責:每位上班一列(只接肖像畫)
  select p.id, p.game_name, p.display_name, p.avatar_url,
         null::smallint, null::text, false, false, true
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  where sg.session_id = p_session and coalesce(p.portrait_only, false)
  union all
  -- 指名互動場(非肖像):每位上班獄卒的每個可指名時格
  select p.id, p.game_name, p.display_name, p.avatar_url,
         s.slot_idx::smallint,
         case when se.start_time is not null
              then to_char(se.start_time + (s.slot_idx * interval '30 minutes'), 'HH24:MI')
              else null end,
         exists (
           select 1 from bookings b
           where b.session_id = p_session and b.status <> 'cancelled'
             and b.requested_slots @> jsonb_build_array(jsonb_build_object('g', p.id::text, 's', s.slot_idx))
         ),
         p.offers_polaroid, false
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  cross join lateral unnest(sg.slots) as s(slot_idx)
  where sg.session_id = p_session and se.kind = 'named' and not coalesce(p.portrait_only, false)
  union all
  -- 集體趕稿場(非肖像):每位上班一列(指定監督)
  select p.id, p.game_name, p.display_name, p.avatar_url,
         null::smallint, null::text,
         exists (
           select 1 from bookings b
           where b.session_id = p_session and b.status <> 'cancelled'
             and b.requested_slots @> jsonb_build_array(jsonb_build_object('g', p.id::text, 's', null))
         ),
         p.offers_polaroid, false
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  where sg.session_id = p_session and se.kind = 'crunch' and not coalesce(p.portrait_only, false)
  order by 2 nulls last, 3 nulls last, 5 nulls last
$function$;

grant execute on function public.session_named_slots(uuid) to anon, authenticated;
