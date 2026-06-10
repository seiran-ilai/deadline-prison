-- 探監廣播完成標記:visits 加 is_done。
-- 整段貼進 Supabase SQL Editor 執行一次即可(若尚未執行 add_visit_guard_and_record_fixes.sql,請先執行那支)。
--
-- 標記完成後,該則廣播停止輪播/顯示:
--   典獄長直播大螢幕的輪播、犯人服刑「本場廣播」、獄卒作業「本場廣播」都只取 is_done = false;
--   服刑紀錄的「過去廣播紀錄」仍保留全部(歷史紀錄)。
-- 標記入口:典獄長主控台「探監登錄」列表、直播大螢幕廣播卡(皆為 warden 視窗,沿用既有 staff 更新權限)。

alter table visits add column if not exists is_done boolean not null default false;
