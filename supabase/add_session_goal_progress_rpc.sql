-- 目的:讓「同場犯人」在不外洩彼此子項目標題的前提下,取得同囚「每個本場目標」的完成度聚合
--      (已完成子項目數 done / 子項目總數 total / 稿件層級 is_done),前端再用統一的
--      computeProgress 判定每個目標是否完成 → 推導「服刑完畢 / 服刑中 / 尚未挑稿」。
--
-- 背景:manuscript_steps 對同囚不可讀(只有擁有者 / staff),所以犯人端原本無法算同囚完成度。
--      這裡用 SECURITY DEFINER 繞過 RLS,但「只回傳數字、不回 step 標題」,並用既有
--      can_see_session_goal() 限制「只能讀與我同場的目標」,維持隱私(私密稿也只露出聚合數)。
--
-- 依賴:can_see_session_goal()(add_session_goals_samesession_read.sql,需先執行過)。
-- 用法:整段貼進 Supabase SQL Editor 執行一次即可。
-- ⚠️ 上線順序:先跑這段 SQL,再部署新前端(前端若呼叫不到此函式會安全降級為「服刑中/尚未挑稿」,不報錯)。

create or replace function public.session_goal_progress(p_session_inmate_ids uuid[])
returns table (
  session_inmate_id uuid,
  goal_id uuid,
  manuscript_id uuid,
  done int,
  total int,
  is_done boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sg.session_inmate_id,
    sg.id as goal_id,
    sg.manuscript_id,
    (count(ms.id) filter (where ms.done))::int as done,
    count(ms.id)::int as total,
    m.is_done
  from session_goals sg
  join manuscripts m on m.id = sg.manuscript_id
  left join manuscript_steps ms on ms.manuscript_id = sg.manuscript_id
  where sg.session_inmate_id = any(p_session_inmate_ids)
    -- can_see_session_goal() 的參數是「session_inmate id」(見 add_session_goals_samesession_read.sql),
    -- 只回傳「與我同場的 session_inmate」之目標,維持同場限制。
    and public.can_see_session_goal(sg.session_inmate_id)
  group by sg.session_inmate_id, sg.id, sg.manuscript_id, m.is_done
$$;

-- 讓登入者可呼叫(回傳僅聚合數字,不含 step 內容)
grant execute on function public.session_goal_progress(uuid[]) to authenticated;
