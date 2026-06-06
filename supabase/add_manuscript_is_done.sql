-- 我的稿件:支援「無子項目稿件直接勾選完成」。
-- 在 manuscripts 加一個布林欄位記錄「無子項目時的完成勾選」。
-- 有子項目時此欄位忽略(完成度照子項目算);無子項目時 is_done 即完成度(true=100%)。
--
-- 用法:整段貼進 Supabase SQL Editor 執行一次即可(需專案擁有者 / service 權限)。
-- ⚠️ 上線順序:請「先跑這段 SQL,再部署新前端」。欄位有預設值、舊前端不會 select 它,
--    所以先加欄位不影響現有資料與現行畫面(expand-then-deploy,安全)。

alter table public.manuscripts
  add column if not exists is_done boolean not null default false;

-- 更新權限沿用現有「本人可改自己稿件」policy,is_done 不需額外 policy。
