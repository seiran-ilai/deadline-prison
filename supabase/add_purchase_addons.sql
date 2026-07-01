-- 加購紀錄 purchase_addons:記錄一場 session 內每筆加購(拍立得、探監、抓捕、肖像畫、監督、入場、指名費等)。
-- 供「加購管理」(寫入)與「場次薪資結算」(讀取)共用。手動貼進 Supabase SQL Editor 跑一次即可(可重複安全執行)。
-- 金額慣例:amount 以「萬」為單位的整數儲存(例:拍立得 5 萬 → 存 5),與站上金額顯示一致。
--
-- addon_type 支援值:
--   polaroid   拍立得(空白)      需對象獄卒 target_guard_id;可加簽繪 with_signature
--   visit      互動探監          target_guard_id = 執行獄卒
--   visit_free 無互動探監(純參觀)
--   capture    監獄外抓捕
--   portrait   肖像畫            需對象獄卒 target_guard_id
--   supervise  集體場指定監督     target_guard_id = 被指定獄卒
--   entry      入場費
--   booking    指名費

create table if not exists public.purchase_addons (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sessions(id) on delete cascade,
  inmate_id       uuid references public.profiles(id) on delete set null,   -- 購買的囚犯(訪客預約可為 null)
  addon_type      text not null
                    check (addon_type in ('polaroid','visit','visit_free','capture','portrait','supervise','entry','booking')),
  target_guard_id uuid references public.profiles(id) on delete set null,   -- 對象/執行獄卒(部分項目才有)
  with_signature  boolean not null default false,                          -- 拍立得加購簽繪(僅 polaroid 有意義)
  amount          integer not null default 0,                              -- 定價,單位:萬
  note            text,
  created_at      timestamptz not null default now(),
  -- 簽繪只依附拍立得:with_signature 為真時 addon_type 必為 polaroid
  constraint purchase_addons_sign_chk check (not with_signature or addon_type = 'polaroid')
);

create index if not exists purchase_addons_session_idx on public.purchase_addons(session_id);
create index if not exists purchase_addons_guard_idx   on public.purchase_addons(target_guard_id);

-- RLS:沿用專案慣例,只有典獄長可增刪改查(結算/加購管理皆典獄長操作)。
alter table public.purchase_addons enable row level security;
drop policy if exists purchase_addons_warden_all on public.purchase_addons;
create policy purchase_addons_warden_all on public.purchase_addons
  for all using (is_warden()) with check (is_warden());
