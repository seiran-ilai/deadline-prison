-- 場次類型(僅標籤,不改變預約/入場流程):集體趕稿 / 指名互動 / 自由入場
-- 對照 src/sessionKind.js。default 'crunch' = 既有場次語意(集體趕稿)。
-- 手動貼進 Supabase SQL Editor 跑一次(前端已部署會領先此 migration,見 MEMORY)。
-- 此檔含兩部分:1) 加 kind 欄位  2) 重建 public_sessions() 把 kind 帶出去。

-- 1) sessions 加 kind 欄位
alter table public.sessions
  add column if not exists kind text not null default 'crunch'
  check (kind in ('crunch', 'named', 'free'));

-- 2) 重建 public_sessions():回傳多一個 kind 欄位(改回傳型別必須先 DROP 再建)。
--    內容沿用原本邏輯,只加上 s.kind 與 RETURNS TABLE 的 kind text。
drop function if exists public.public_sessions();

create function public.public_sessions()
 returns table(id uuid, title text, session_date date, capacity integer, booked integer, display_status text, can_book boolean, has_password boolean, kind text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id, s.title, s.session_date, s.capacity,
         coalesce((
           select count(*) from bookings b
           where b.session_id = s.id and b.status <> 'cancelled'
         ), 0)::int as booked,
         st.v as display_status,
         (st.v = 'booking') as can_book,
         exists (select 1 from session_passwords sp where sp.session_id = s.id) as has_password,
         coalesce(s.kind, 'crunch') as kind
  from sessions s
  cross join lateral (
    -- 與前端 normalizeStatus 同步:過渡期舊值 open/closed 先正規化成五態
    select case
      when s.status = 'open' then (case when s.timer_started_at is not null then 'serving' else 'booking' end)
      when s.status = 'closed' then 'ended'
      else s.status
    end as v
  ) st
  where coalesce(s.is_public, true)   -- 內部場不外露
    and st.v <> 'ended'               -- 已結束場不外露
  order by s.session_date nulls last, s.created_at
$function$;

-- DROP 會清掉原本的執行權限,重新授回(官網匿名訪客要叫得動此函式)
grant execute on function public.public_sessions() to anon, authenticated;
