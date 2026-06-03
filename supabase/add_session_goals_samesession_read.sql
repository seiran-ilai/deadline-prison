-- 目的:讓「同場的犯人」能讀彼此的 session_goals(本場同囚要顯示對方挑了哪些稿)。
-- 現況:session_goals 的 SELECT 只允許「自己 + 管理者」,所以一般犯人讀不到同囚的目標。
-- 作法:新增一條「同場可讀」的 SELECT policy(permissive,與現有 policy 以 OR 合併)。
--      INSERT / DELETE 規則完全不動,仍限「自己 + 管理者」。
--
-- 安全性:判斷用 SECURITY DEFINER 函式,執行時不套呼叫者 RLS → 不會觸發遞迴。
-- 用法:整段貼進 Supabase SQL Editor 執行一次。

-- 1) 判斷「某筆 session_goals(用 session_inmate_id 指認)是否與我同場」
create or replace function public.can_see_session_goal(p_session_inmate uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from session_inmates si_target
    join session_inmates si_me
      on si_me.session_id = si_target.session_id
    where si_target.id = p_session_inmate
      and si_me.member_id = auth.uid()
  );
$$;

-- 2) 新增「同場可讀」SELECT policy(staff 或 同場;自己也屬同場故一併涵蓋)
drop policy if exists "session_goals_select_samesession" on public.session_goals;

create policy "session_goals_select_samesession"
on public.session_goals
for select
using (
  is_staff()
  or public.can_see_session_goal(session_inmate_id)
);
