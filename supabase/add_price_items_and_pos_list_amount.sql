-- 品項價目表 + POS 定價紀錄。手動貼進 Supabase SQL Editor 跑一次即可(可重複安全執行)。
-- 1) price_items:各品項定價/優惠價/獄卒得,依場次類型分類。官網(匿名)可讀、典獄長可寫。
--    有優惠價時官網顯示「定價劃線 + 優惠價」;結帳時可選擇以優惠價或定價結帳。
--    guard_cut = 獄卒得(每單位拆帳,薪資結算讀此欄;null = 不參與拆帳)。監獄得 = 實收 − 獄卒得。
--    優惠結帳不影響薪資結算:獄卒仍照 guard_cut 拿,優惠差額由監獄吸收。
-- 2) pos_order_items.list_amount:該筆「以定價計」的金額;amount(實收)低於 list_amount 即為優惠
--    (含結帳時手動調價,一律記錄為優惠)。金額單位:萬。

create table if not exists public.price_items (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('crunch', 'named', 'free')),
  item_key    text not null,          -- 對應 POS item_type / 官網品項鍵(signup/supervise/visit/polaroid/sign/portrait/nominate/entry/capture/capture_add)
  name        text not null,
  unit        text,                   -- 顯示單位(萬 / 萬／張 / 萬／30 分鐘…)
  list_price  numeric not null default 0,   -- 定價
  sale_price  numeric,                -- 優惠價(null = 無優惠)
  guard_cut   numeric,                -- 獄卒得/每單位(null = 不參與拆帳)
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (kind, item_key)
);

-- 先前已建表(舊版無 guard_cut)也可安全補欄
alter table public.price_items add column if not exists guard_cut numeric;

alter table public.price_items enable row level security;
drop policy if exists price_items_public_read on public.price_items;
create policy price_items_public_read on public.price_items
  for select using (true);
drop policy if exists price_items_warden_all on public.price_items;
create policy price_items_warden_all on public.price_items
  for all using (is_warden()) with check (is_warden());

-- 讓官網未登入也讀得到
grant select on public.price_items to anon, authenticated;

-- 種子資料(對齊目前系統價格與拆帳;探監互動定價改回 10 萬、試營運優惠價 5 萬)。已存在的鍵不覆蓋。
-- guard_cut 對齊 salaryRules 現行拆帳:監督 5、探監 5、拍立得(空白)3.5、簽繪加購 +2.5(合計簽繪拍立得 6)、
-- 肖像 80(全歸)、指名 15(全歸);入場費/無指名入場歸監獄(0);抓捕不參與結算(null)。
insert into public.price_items (kind, item_key, name, unit, list_price, sale_price, guard_cut, sort_order) values
  ('crunch', 'signup',      '入場費',           '萬',          20, null, 0,    1),
  ('crunch', 'supervise',   '指定監督獄卒',     '萬',          10, null, 5,    2),
  ('crunch', 'visit',       '互動探監',         '萬',          10, 5,    5,    3),
  ('crunch', 'polaroid',    '拍立得（空白）',   '萬／張',       5, null, 3.5,  4),
  ('crunch', 'sign',        '拍立得加購簽繪',   '萬／張',       3, null, 2.5,  5),
  ('crunch', 'capture',     '監獄外抓捕',       '萬起',        30, null, null, 6),
  ('crunch', 'capture_add', '抓捕加派獄卒',     '萬／位',      15, null, null, 7),
  ('crunch', 'portrait',    '肖像畫',           '萬',          80, null, 80,   8),
  ('named',  'nominate',    '指名費',           '萬／30 分鐘', 15, null, 15,   1),
  ('named',  'entry',       '無指名入場',       '萬',           1, null, 0,    2),
  ('named',  'polaroid',    '拍立得（空白）',   '萬／張',       5, null, 3.5,  3),
  ('named',  'sign',        '拍立得加購簽繪',   '萬／張',       3, null, 2.5,  4),
  ('named',  'portrait',    '肖像畫',           '萬',          80, null, 80,   5)
on conflict (kind, item_key) do nothing;

-- 舊版種子(無 guard_cut)已入庫者:補預設拆帳值(只補 null,不覆蓋已手動設定的值)
update public.price_items p set guard_cut = v.gc
from (values
  ('crunch','signup',0::numeric), ('crunch','supervise',5), ('crunch','visit',5),
  ('crunch','polaroid',3.5), ('crunch','sign',2.5), ('crunch','portrait',80),
  ('named','nominate',15), ('named','entry',0), ('named','polaroid',3.5),
  ('named','sign',2.5), ('named','portrait',80)
) as v(kind, item_key, gc)
where p.kind = v.kind and p.item_key = v.item_key and p.guard_cut is null;

-- POS 品項:以定價計的金額(結帳時寫入;amount < list_amount 即為優惠)
alter table public.pos_order_items add column if not exists list_amount numeric;
