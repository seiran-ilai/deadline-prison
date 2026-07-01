-- 指名時段複選 + 每卒加購 + 集體場指定監督 + 抓捕訂單。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- 設計:
--   * bookings 改用 jsonb 存「多組指名」與「每卒加購」,取代單欄 requested_guard_id/requested_slot。
--       requested_slots = [{ "g": guard_uuid_text, "s": slot_index | null }, ...]   -- named 帶時格 index;crunch 為 s=null(指定監督)
--       addons          = [{ "g": guard_uuid_text, "polaroid": n, "sign": n }, ...] -- 每卒加購數量(0=未加購)
--       capture         = { "client":.., "target":.., "server":.. } | null          -- 集體場「把朋友抓進去」訂單
--   * 互斥(named 的 g+s、crunch 的 g 只接一人)改由伺服器端在 /api/booking 以 session_named_slots.taken 檢查兜底,
--     故移除舊的部分唯一索引 bookings_named_slot_uniq(陣列無法用簡單唯一索引)。
--   * 舊單欄保留供回填/相容,程式改讀 jsonb。

-- 1) 新欄位
alter table public.bookings
  add column if not exists requested_slots jsonb not null default '[]'::jsonb,
  add column if not exists addons          jsonb not null default '[]'::jsonb,
  add column if not exists capture         jsonb;

-- 2) 由舊單欄回填 requested_slots(只填尚未有 jsonb 的既有列)
update public.bookings
set requested_slots = jsonb_build_array(jsonb_build_object('g', requested_guard_id::text, 's', requested_slot))
where requested_guard_id is not null and requested_slot is not null
  and (requested_slots is null or requested_slots = '[]'::jsonb);

-- 3) 移除舊的指名時格唯一索引(改伺服器端擋重複)
drop index if exists public.bookings_named_slot_uniq;

-- 4) 重寫 session_named_slots:named 每時格一列;crunch 每位上班獄卒一列(slot_index=null,指定監督)。
--    taken 改以 bookings.requested_slots 是否含 {g,s} 且未取消計。
create or replace function public.session_named_slots(p_session uuid)
 returns table(guard_id uuid, game_name text, display_name text, avatar_url text,
               slot_index smallint, slot_label text, taken boolean)
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
         ) as taken
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
         ) as taken
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  cross join se
  where sg.session_id = p_session and se.kind = 'crunch'
  order by 2 nulls last, 3 nulls last, 5 nulls last
$function$;

grant execute on function public.session_named_slots(uuid) to anon, authenticated;
