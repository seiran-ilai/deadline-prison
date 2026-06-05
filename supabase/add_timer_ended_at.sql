-- 番茄鐘提早結束:sessions 新增收尾時間欄(nullable、預設 null)
-- 有值 = 典獄長提早結束本場,前端顯示收尾。
-- RLS 是 row-level,現有 warden 更新 sessions 的政策即涵蓋此新欄位,不需新增 column-level 限制。
alter table sessions add column if not exists timer_ended_at timestamptz;
