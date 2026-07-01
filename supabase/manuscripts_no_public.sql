-- 稿件不再對「同場犯人」公開:把既有 public 稿件改為 staff(僅本人 + 負責獄卒 + 典獄長可見)。
-- 前端已移除隱私設定,一律以 'staff' 建檔;此檔把歷史 public 稿件一併關閉對同場犯人的曝光。
-- 手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。

update public.manuscripts set visibility = 'staff' where visibility = 'public';

-- (選用)若 manuscripts 的 RLS 有「同場犯人可讀 public 稿件」的 policy,建議一併移除,
--   讓稿件永遠只有本人 + staff(is_warden / 專屬獄卒)可讀。請依你實際的 policy 名稱調整:
-- drop policy if exists manuscripts_select_session_public on public.manuscripts;
