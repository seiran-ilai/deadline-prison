-- 獄卒 MEMO / 確認項:每場 or 指定場、可綁犯人、分場完成狀態。
-- 用法:整段貼進 Supabase SQL Editor 執行一次即可(需專案擁有者 / service 權限)。
--
-- 身分識別對齊現況:
--   guard_id / target_prisoner_id 皆 = profiles.id(= auth.uid()),uuid。
--   sessions「進行中 + 預約中」= status='open'(已結束 = 'closed');下拉沿用此過濾。

-- ========== 1) guard_memos ==========
create table if not exists public.guard_memos (
  id                  uuid primary key default gen_random_uuid(),
  guard_id            uuid not null references public.profiles(id) on delete cascade,  -- 擁有者 = 登入獄卒
  content             text not null,
  scope               text not null check (scope in ('every', 'session')),            -- every=每場 / session=指定場
  session_id          uuid references public.sessions(id) on delete cascade,           -- scope=session 時必填
  target_prisoner_id  uuid references public.profiles(id) on delete set null,          -- 選填:綁定犯人(對齊 profiles.id)
  created_at          timestamptz not null default now(),
  -- scope=session 一定要有 session_id
  constraint guard_memos_session_required check (scope <> 'session' or session_id is not null)
);
create index if not exists guard_memos_guard_idx   on public.guard_memos(guard_id);
create index if not exists guard_memos_session_idx on public.guard_memos(session_id);

-- ========== 2) guard_memo_checks(分場完成狀態)==========
create table if not exists public.guard_memo_checks (
  id          uuid primary key default gen_random_uuid(),
  memo_id     uuid not null references public.guard_memos(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  unique (memo_id, session_id)   -- 一條 memo 在一場只一筆;有列 = 該場已完成
);
create index if not exists guard_memo_checks_memo_idx on public.guard_memo_checks(memo_id);

-- ========== 3) RLS ==========
alter table public.guard_memos       enable row level security;
alter table public.guard_memo_checks enable row level security;

-- guard_memos:只能增刪改查自己的(guard_id = auth.uid())
drop policy if exists guard_memos_all_own on public.guard_memos;
create policy guard_memos_all_own on public.guard_memos
  for all
  using (guard_id = auth.uid())
  with check (guard_id = auth.uid());

-- guard_memo_checks:僅該 memo 的擁有者可增刪查
drop policy if exists guard_memo_checks_all_own on public.guard_memo_checks;
create policy guard_memo_checks_all_own on public.guard_memo_checks
  for all
  using (exists (select 1 from public.guard_memos m where m.id = memo_id and m.guard_id = auth.uid()))
  with check (exists (select 1 from public.guard_memos m where m.id = memo_id and m.guard_id = auth.uid()));
