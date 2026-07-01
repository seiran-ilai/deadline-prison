-- 指名互動場「現場報到 + 購買項目」:bookings 加到場旗標與品項旗標。
-- 手動貼進 Supabase SQL Editor 跑一次即可(add column if not exists,可重複安全執行)。
-- 設計:
--   * 只有指名場(kind='named')的「進行中場次 → 指名現場」面板會用到這些欄位;其它場忽略。
--   * item_polaroid_sign(拍立得簽繪)依附 item_polaroid(拍立得):sign=true 時 polaroid 必為 true。
--     前端 / 預約 API / 後台面板皆兜底此規則,DB 端另用 CHECK 兜底。
--   * 更新權限沿用既有 bookings_update policy(本人或 is_warden() 可改),典獄長後台即可勾到場/品項,不需新 policy。

alter table public.bookings
  add column if not exists arrived            boolean not null default false,  -- 到場
  add column if not exists item_named         boolean not null default true,   -- 指名(指名場預設有)
  add column if not exists item_polaroid      boolean not null default false,  -- 拍立得
  add column if not exists item_polaroid_sign boolean not null default false;  -- 拍立得簽繪(依附 item_polaroid)

-- 簽繪依附拍立得:DB 端兜底(sign 為真時 polaroid 必為真)。
alter table public.bookings drop constraint if exists bookings_polaroid_sign_chk;
alter table public.bookings
  add constraint bookings_polaroid_sign_chk
  check (item_polaroid or not item_polaroid_sign);
