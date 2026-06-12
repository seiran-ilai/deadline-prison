-- 清除「已註冊犯人」資料(role = 'member' 全部;獄方 guard/warden 保留)。
-- 背景:帳號體系改為典獄長核發,既有自行註冊的犯人帳號與資料一併清除,
--       之後由「收監登記」重新開立。
-- ⚠️ 破壞性操作:執行前先確認名單(下方步驟 0),執行後僅能靠 _backup_0612_* 備份表還原。
-- ⚠️ 官網犯人牆/名人堂會因資料清空而變空。
-- 註:不用 temp table(Supabase SQL Editor 不支援,會報 relation does not exist);
--     利用 profiles.id → auth.users(id) on delete cascade,最後刪 auth.users 一步帶走
--     profiles 及其下所有 cascade 資料,刪除前每步都以即時子查詢取犯人集合。

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

-- 2) 解除 NO ACTION 外鍵:犯人開的場次/任務改掛典獄長(沿用 0611 清理腳本的做法)
update sessions set opened_by = (select id from profiles where role = 'warden' limit 1)
 where opened_by in (select id from profiles where role = 'member');
update tasks set created_by = (select id from profiles where role = 'warden' limit 1)
 where created_by in (select id from profiles where role = 'member');

-- 3) 無外鍵連動的表:預約與預排任務(必須在刪 auth.users 之前,profiles 還查得到)
delete from booking_goals where user_id in (select id from profiles where role = 'member');
delete from bookings      where user_id in (select id from profiles where role = 'member');

-- 4) 刪登入帳號:auth.users → cascade 帶走 profiles,再連鎖帶走
--    稿件/步驟/場次名單/探監/備忘/排班等所有掛在 profiles 底下的資料
delete from auth.users where id in (select id from profiles where role = 'member');

-- 5) 序列對齊現存最大編號,之後「收監登記」從這裡往下發號
select setval('public.inmate_no_seq', coalesce((select max(inmate_no) from profiles), 1));

commit;
