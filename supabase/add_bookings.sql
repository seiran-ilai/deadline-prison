-- 入監服刑(預約)功能:新增 bookings 表 + 人數上限 capacity + RLS + 公開計數函式。
-- 整段貼進 Supabase SQL Editor 執行一次即可。本次只動 bookings(與 sessions.capacity 一欄),
-- 不動 sessions 既有欄位與番茄鐘邏輯。

-- 1) bookings 表 ───────────────────────────────────────────────
create table if not exists bookings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  user_id     uuid not null,                    -- 對應 auth.uid()
  dc_id       text not null,                    -- Discord ID(OAuth 帶入)
  dc_name     text not null,                    -- Discord 暱稱(OAuth 帶入)
  note        text,                             -- 預約備註(選填)
  status      text not null default 'pending',  -- pending / confirmed / cancelled
  created_at  timestamptz not null default now()
);

-- 同一人不可重複預約同一場(DB 兜底唯一鍵)
create unique index if not exists bookings_session_user_uniq
  on bookings (session_id, user_id);
-- 後台依場次撈預約用
create index if not exists bookings_session_idx on bookings (session_id);

-- 2) 人數上限(沿用 sessions;null = 不限) ──────────────────────
alter table sessions add column if not exists capacity int;

-- 3) RLS:row-level,沿用專案現有 is_warden() 寫法 ───────────────
alter table bookings enable row level security;

-- insert:只能新增自己的列(user_id = auth.uid())
drop policy if exists bookings_insert_own on bookings;
create policy bookings_insert_own on bookings
  for insert with check (user_id = auth.uid());

-- select:本人讀自己的;典獄長讀全部(獄卒比照犯人,只看自己的)
drop policy if exists bookings_select on bookings;
create policy bookings_select on bookings
  for select using (user_id = auth.uid() or is_warden());

-- update:本人改自己的(取消)、典獄長改任意列(改狀態)
drop policy if exists bookings_update on bookings;
create policy bookings_update on bookings
  for update using (user_id = auth.uid() or is_warden())
  with check (user_id = auth.uid() or is_warden());

-- delete:本人刪自己的、典獄長刪任意列
drop policy if exists bookings_delete on bookings;
create policy bookings_delete on bookings
  for delete using (user_id = auth.uid() or is_warden());

-- 4) 公開場次 + 已預約數(SECURITY DEFINER 繞 RLS,供免登入的 /sessions、/serve 顯示計數)
--    只回 open 場次的公開欄位與「未取消」預約數,不外洩個別預約資料。
create or replace function public.public_sessions()
returns table (id uuid, title text, session_date date, capacity int, booked int)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.title, s.session_date, s.capacity,
         coalesce((
           select count(*) from bookings b
           where b.session_id = s.id and b.status <> 'cancelled'
         ), 0)::int as booked
  from sessions s
  where s.status = 'open'
  order by s.session_date nulls last, s.created_at
$$;

grant execute on function public.public_sessions() to anon, authenticated;

-- 5) 公開獄方名冊(/staff 免登入):只回 guard/warden 的公開展示欄位
create or replace function public.public_staff()
returns table (id uuid, game_name text, display_name text, avatar_url text, role text)
language sql
security definer
set search_path = public
stable
as $$
  select id, game_name, display_name, avatar_url, role
  from profiles
  where role in ('guard', 'warden')
  order by case role when 'warden' then 0 else 1 end, inmate_no
$$;

grant execute on function public.public_staff() to anon, authenticated;
