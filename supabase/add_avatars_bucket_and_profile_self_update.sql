-- 個人資料卡 / 可編輯頭像所需的 Storage bucket 與 RLS。
-- 用法:整段貼進 Supabase SQL Editor 執行一次即可(需要專案擁有者 / service 權限,前端 anon key 無法建立)。
--
-- 包含:
--   1) avatars bucket(public 讀取、限圖片、5MB 上限)
--   2) storage.objects 的 RLS:任何人可讀、登入者可寫/改/刪 avatars
--   3) profiles 的「本人可更新自己那列」policy(暱稱 / 頭像)
--      role 欄位仍由既有 protect_role_column 觸發器保護,本 policy 不影響該限制。

-- ========== 1) avatars bucket ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true,
  5242880,  -- 5 MB
  array['image/png','image/jpeg','image/jpg','image/webp','image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ========== 2) storage.objects RLS(只針對 avatars bucket)==========
-- 公開讀取(bucket 本身 public,policy 一併補上以涵蓋 list/讀取)
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- 已登入者可上傳
drop policy if exists "avatars_auth_insert" on storage.objects;
create policy "avatars_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

-- 已登入者可覆寫(upsert / 換圖)
drop policy if exists "avatars_auth_update" on storage.objects;
create policy "avatars_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars') with check (bucket_id = 'avatars');

-- 已登入者可刪除(換圖時清理)
drop policy if exists "avatars_auth_delete" on storage.objects;
create policy "avatars_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars');

-- ========== 3) profiles:本人可更新自己那列 ==========
-- permissive policy,與既有(典獄長)update policy 以 OR 合併。
-- role 變更仍受 protect_role_column 觸發器限制,一般使用者只能改暱稱 / 頭像。
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
