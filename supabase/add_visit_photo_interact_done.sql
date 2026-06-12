-- 探監執行確認:已經合照 / 已經執行指定互動。
-- 整段貼進 Supabase SQL Editor 執行一次即可。⚠️ 需在部署本次前端改版「之前」執行,
-- 否則典獄長探監列表/看守紀錄查詢會因欄位不存在而報錯。
--
-- 用途:
--   1) 典獄長「探監登錄」對每筆探監可勾「已經合照」「已經執行指定互動」(可取消重勾)
--   2) 獄卒「看守紀錄」依 visits.guard_id = 自己 且已確認的筆數,統計合照次數/互動次數
--
-- 權限沿用既有 policy,不需新增:
--   - 寫入:既有 staff 寫入 policy(典獄長按鈕走 update)
--   - 讀取:visits_select_participants(指定獄卒必為該場參與者,讀得到自己的筆數)

alter table visits add column if not exists photo_done    boolean not null default false;
alter table visits add column if not exists interact_done boolean not null default false;

comment on column visits.photo_done    is '典獄長確認:已經合照';
comment on column visits.interact_done is '典獄長確認:已經執行指定互動';
