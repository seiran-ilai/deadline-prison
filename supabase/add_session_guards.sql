-- 指名互動場:獄卒排班 + 半小時時段預約。手動貼進 Supabase SQL Editor 跑一次。
-- 設計:
--   * 場次有「開始時間 start_time + 段數 slot_count」→ 自動切 30 分一段的時格(index 0..slot_count-1)。
--   * 每位「當日上班」獄卒(session_guards 一列),用 slots(smallint[])挑哪幾個時格可被指名(子集)。
--   * 預約指名 = 選(獄卒, 時格);一位獄卒同一時格只接一名客人(部分唯一索引兜底)。
--   * 只用於 kind='named' 場。預約頁(含匿名訪客)透過 SECURITY DEFINER 的 session_named_slots() 讀。

-- 1) 場次加「開始時間」「段數」(只有指名場會用到;其它場留空/預設亦無妨)。
alter table public.sessions
  add column if not exists start_time time,
  add column if not exists slot_count smallint not null default 4;

-- 2) session_guards:某場「當日上班」獄卒;slots = 可被指名的時格 index 陣列(空 = 上班但不可指名)。
create table if not exists public.session_guards (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  guard_id uuid not null references public.profiles(id) on delete cascade,
  slots smallint[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (session_id, guard_id)
);
-- 若曾跑過早期版本(只有 nameable 旗標、無 slots)→ 補欄位、移除舊欄位,讓本檔可重複安全執行。
alter table public.session_guards add column if not exists slots smallint[] not null default '{}';
alter table public.session_guards drop column if exists nameable;
create index if not exists session_guards_session_idx on public.session_guards(session_id);

-- RLS:典獄長可增刪改查(預約頁讀取走下方 SECURITY DEFINER RPC,不需開放 anon 直查)。
alter table public.session_guards enable row level security;
drop policy if exists session_guards_warden_all on public.session_guards;
create policy session_guards_warden_all on public.session_guards
  for all using (is_warden()) with check (is_warden());

-- 3) bookings 加「指名獄卒 + 時格」:皆 null = 不指定(由典獄長安排)。
alter table public.bookings
  add column if not exists requested_guard_id uuid references public.profiles(id) on delete set null,
  add column if not exists requested_slot smallint;

-- 一位獄卒同一場同一時格只接一名(未取消的預約才算佔位;取消的不擋)。
create unique index if not exists bookings_named_slot_uniq
  on public.bookings(session_id, requested_guard_id, requested_slot)
  where requested_guard_id is not null and requested_slot is not null and status <> 'cancelled';

-- 4) 預約頁用:回傳某場每位可指名獄卒的每個時格(含是否已被搶 taken、時鐘標籤 slot_label)。
-- 清掉早期版本的舊函式(若有),避免殘留。
drop function if exists public.session_nameable_guards(uuid);

create or replace function public.session_named_slots(p_session uuid)
 returns table(guard_id uuid, game_name text, display_name text, avatar_url text,
               slot_index smallint, slot_label text, taken boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, p.game_name, p.display_name, p.avatar_url,
         s.slot_idx::smallint as slot_index,
         case when se.start_time is not null
              then to_char(se.start_time + (s.slot_idx * interval '30 minutes'), 'HH24:MI')
              else null end as slot_label,
         exists (
           select 1 from bookings b
           where b.session_id = p_session
             and b.requested_guard_id = p.id
             and b.requested_slot = s.slot_idx
             and b.status <> 'cancelled'
         ) as taken
  from session_guards sg
  join profiles p on p.id = sg.guard_id
  join sessions se on se.id = sg.session_id
  cross join lateral unnest(sg.slots) as s(slot_idx)
  where sg.session_id = p_session
  order by p.game_name nulls last, p.display_name nulls last, s.slot_idx
$function$;

grant execute on function public.session_named_slots(uuid) to anon, authenticated;
