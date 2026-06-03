-- 修正:session_inmates 的 SELECT policy 無限遞迴 (Postgres error 42P17)
-- 原因:policy 的「同場」條件內嵌 `select ... from session_inmates`,
--      評估時又觸發同一條 policy → infinite recursion → REST 回 500。
-- 解法:把「我是否在此場次」的判斷抽到 SECURITY DEFINER 函式,
--      該函式執行時不套呼叫者的 RLS,藉此打破遞迴。
--
-- 用法:整段貼進 Supabase SQL Editor 執行一次即可。

-- 1) 同場判斷函式(SECURITY DEFINER 繞過 RLS,打破遞迴)
create or replace function public.is_in_session(p_session uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from session_inmates
    where session_id = p_session
      and member_id = auth.uid()
  );
$$;

-- 2) 砍掉 session_inmates 上所有現有的 SELECT policy(不需先知道名字)
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'session_inmates'
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.session_inmates', pol.policyname);
  end loop;
end $$;

-- 3) 重建 SELECT policy:staff、本人、或同場(改用函式,不再內嵌子查詢)
create policy "session_inmates_select"
on public.session_inmates
for select
using (
  is_staff()
  or member_id = auth.uid()
  or public.is_in_session(session_id)
);
