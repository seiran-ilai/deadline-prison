-- 番茄鐘預設輪數 8 → 4。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- 前端開新場已明確帶 total_rounds=4;此檔把「資料庫欄位預設」也一併改成 4,雙保險。
-- 長休規則(前端 pomodoro.js):每 8 輪一次 15 分長休,未達 8 輪全程只有 5 分放風。

-- 1) 改欄位預設(只影響「之後新建、且沒帶 total_rounds」的場次)
alter table public.sessions alter column total_rounds set default 4;

-- 2)(選用)把「尚未開始、仍是舊預設 8 輪」的場次一併改成 4。
--    只動還沒入場/服刑的場,已結束或進行中的場不動,避免影響歷史統計與正在跑的番茄鐘。
--    確定要順手清舊資料再取消下面註解執行:
-- update public.sessions
--   set total_rounds = 4
--   where total_rounds = 8
--     and status in ('open', 'booking', 'booking_paused');
