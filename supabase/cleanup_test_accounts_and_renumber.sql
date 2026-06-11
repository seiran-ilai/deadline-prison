-- 資料清理:刪除測試帳號 + 全體 inmate_no 依建立時間重編(2026-06-11 已於線上執行)。
-- 本檔為執行紀錄,請勿重複執行(重跑會再次位移編號;備份表已存在則 CTAS 會略過,失去當下快照意義)。
--
-- 刪除對象(由典獄長於階段一確認):
--   7e5c61e9-055e-4d8f-adfe-e0a155f97293  獄卒測試 T001 / test001(warden)
--   cfe1a40e-7587-487a-b736-df78968a6380  test002(member)
-- 重編結果:7→1 伊萊諾斯、11→2 閻羅、13→3 rabbit851207、15→4 alin0609、
--   16→5 seolfor_ffxiv、17→6 mira_jya1115、18→7 卡特菈、19→8 泉蓮、20→9 ikajiji.
-- inmate_no 無任何外鍵引用,重編不需同步其他資料表;前端顯示(No.0001 四位補零)不變。
--
-- ⚠️ 配套手動步驟:Dashboard → Authentication → Users 刪除 test001 / test002 登入帳號,
--   否則重新登入會觸發 claim_profile 長出新 profile。
-- 備份表 _backup_0611_* 留在 DB 作回復點,確認無誤後可另行清理。

begin;

-- 0) 可逆備份:整表 snapshot 留在 DB(_backup_0611_ 前綴)
create table if not exists _backup_0611_profiles          as select * from profiles;
create table if not exists _backup_0611_sessions          as select * from sessions;
create table if not exists _backup_0611_session_inmates   as select * from session_inmates;
create table if not exists _backup_0611_bookings          as select * from bookings;
create table if not exists _backup_0611_booking_goals     as select * from booking_goals;
create table if not exists _backup_0611_session_goals     as select * from session_goals;
create table if not exists _backup_0611_manuscripts       as select * from manuscripts;
create table if not exists _backup_0611_manuscript_steps  as select * from manuscript_steps;
create table if not exists _backup_0611_visits            as select * from visits;
create table if not exists _backup_0611_guard_memos       as select * from guard_memos;
create table if not exists _backup_0611_guard_memo_checks as select * from guard_memo_checks;
create table if not exists _backup_0611_inmate_guards     as select * from inmate_guards;
create table if not exists _backup_0611_tasks             as select * from tasks;

-- 1) 解除 NO ACTION 外鍵:測試帳號開的場次/任務改掛典獄長(伊萊諾斯)
update sessions set opened_by = '80bdddb3-b51a-4489-bd16-3684013f4247'
 where opened_by in ('7e5c61e9-055e-4d8f-adfe-e0a155f97293','cfe1a40e-7587-487a-b736-df78968a6380');
update tasks set created_by = '80bdddb3-b51a-4489-bd16-3684013f4247'
 where created_by in ('7e5c61e9-055e-4d8f-adfe-e0a155f97293','cfe1a40e-7587-487a-b736-df78968a6380');

-- 2) 刪兩帳號的預約與預排任務(booking_goals/bookings 以 user_id 關聯,無外鍵不會自動連動)
delete from booking_goals where user_id in
  ('7e5c61e9-055e-4d8f-adfe-e0a155f97293','cfe1a40e-7587-487a-b736-df78968a6380');
delete from bookings where user_id in
  ('7e5c61e9-055e-4d8f-adfe-e0a155f97293','cfe1a40e-7587-487a-b736-df78968a6380');

-- 3) 刪測試帳號(cascade 帶走稿件/步驟/場次名單/備忘/排班)
delete from profiles where id in
  ('7e5c61e9-055e-4d8f-adfe-e0a155f97293','cfe1a40e-7587-487a-b736-df78968a6380');

-- 4) 重編號:先整體位移避開唯一索引,再依建立時間從 1 連號
update profiles set inmate_no = inmate_no + 1000 where inmate_no is not null;
with ordered as (
  select id, row_number() over (order by created_at, inmate_no) as rn
  from profiles
)
update profiles p set inmate_no = o.rn from ordered o where p.id = o.id;

commit;
