-- 清除「已註冊犯人」資料(role = 'member' 全部;獄方 guard/warden 保留)。
-- 背景:帳號體系改為典獄長核發,既有自行註冊的犯人帳號與資料一併清除,
--       之後由「收監登記」重新開立。
-- ⚠️ 破壞性操作:執行前先確認名單(下方步驟 0),執行後僅能靠 _backup_0612_* 備份表還原。
-- ⚠️ 連同 auth.users 一併刪除(否則對方仍可登入);官網犯人牆/名人堂會因資料清空而變空。

-- 0) 先單獨跑這句確認要刪的名單(確認 role 標記正確、沒有誤標的獄卒):
-- select id, inmate_no, display_name, game_name, discord_account, role from profiles where role = 'member' order by inmate_no;

begin;

-- 1) 可逆備份:整表 snapshot 留在 DB(_backup_0612_ 前綴;已存在則略過)
create table if not exists _backup_0612_profiles          as select * from profiles;
create table if not exists _backup_0612_sessions          as select * from sessions;
create table if not exists _backup_0612_session_inmates   as select * from session_inmates;
create table if not exists _backup_0612_bookings          as select * from bookings;
create table if not exists _backup_0612_booking_goals     as select * from booking_goals;
create table if not exists _backup_0612_session_goals     as select * from session_goals;
create table if not exists _backup_0612_manuscripts       as select * from manuscripts;
create table if not exists _backup_0612_manuscript_steps  as select * from manuscript_steps;
create table if not exists _backup_0612_visits            as select * from visits;
create table if not exists _backup_0612_guard_memos       as select * from guard_memos;
create table if not exists _backup_0612_guard_memo_checks as select * from guard_memo_checks;
create table if not exists _backup_0612_inmate_guards     as select * from inmate_guards;
create table if not exists _backup_0612_tasks             as select * from tasks;

-- 2) 待刪集合:全部犯人(role = 'member')
create temp table _victims as select id from profiles where role = 'member';

-- 3) 解除 NO ACTION 外鍵:犯人開的場次/任務改掛典獄長(沿用 0611 清理腳本的做法)
update sessions set opened_by = (select id from profiles where role = 'warden' limit 1)
 where opened_by in (select id from _victims);
update tasks set created_by = (select id from profiles where role = 'warden' limit 1)
 where created_by in (select id from _victims);

-- 4) 無外鍵連動的表:預約與預排任務
delete from booking_goals where user_id in (select id from _victims);
delete from bookings      where user_id in (select id from _victims);

-- 5) 刪 profiles(cascade 帶走稿件/步驟/場次名單/探監/備忘/排班)
delete from profiles where id in (select id from _victims);

-- 6) 刪登入帳號(auth.users;identities/sessions 隨之 cascade)——
--    不刪的話這些人重新登入會觸發 claim_profile 長出新 profile(雖然登入入口已移除,仍防萬一)
delete from auth.users where id in (select id from _victims);

drop table _victims;

-- 7) 序列對齊現存最大編號,之後「收監登記」從這裡往下發號
select setval('public.inmate_no_seq', coalesce((select max(inmate_no) from profiles), 1));

commit;
