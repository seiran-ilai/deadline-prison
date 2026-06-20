-- 修正:典獄長在後台「進行中場次 → 探監登錄」面板讀不到本場探監紀錄。
-- 整段貼進 Supabase SQL Editor 執行一次即可。
--
-- 原因:
--   visits 既有的讀取 policy(visits_select_participants)只放行
--   「本人(inmate_id=我)」或「同場參與者(session_inmates.member_id=我)」。
--   但典獄長不會把自己報到進 session_inmates,所以不符合任何讀取條件 → 讀到空清單。
--   (他仍能 insert/管理探監,於是出現「登錄成功卻看不到」的不對稱。)
--
-- 作法:
--   additive 多一條 permissive 的 SELECT policy,放行典獄長讀全部 visits。
--   permissive 多條是 OR 關係,不影響既有 participant policy(犯人/獄卒的「本場廣播」照舊)。
--   只放行 is_warden()(後台探監登錄面板本就是典獄長專用),維持最小授權。

drop policy if exists visits_select_staff on visits;
create policy visits_select_staff on visits
  for select using (public.is_warden());
