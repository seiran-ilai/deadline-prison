-- 不註冊預約(訪客預約):官網入監報名可只留遊戲暱稱,不建任何帳號。
--   訪客列以 user_id = null 標記,僅記錄 game_name;無帳號、無法登入系統。
--   寫入一律走 /api/booking-guest(service_role),不開放 anon 直接 insert(RLS 不變)。
-- ⚠️ 需在部署前於 Supabase SQL Editor 執行一次。
-- 註:欄位原本已可空的話,drop not null 是無害的 no-op,可放心整段執行。

begin;

alter table public.bookings alter column user_id drop not null;
alter table public.bookings alter column dc_id   drop not null;
alter table public.bookings alter column dc_name drop not null;

commit;
