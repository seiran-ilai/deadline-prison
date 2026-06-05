-- 場次總覽:sessions 需要 session_date(場次日期,nullable)。
-- 若你的 sessions 表已有此欄,這段 if not exists 不會有副作用。
-- RLS 是 row-level,現有 warden 編輯 sessions 的政策即涵蓋此欄,不需新增限制。
alter table sessions add column if not exists session_date date;
