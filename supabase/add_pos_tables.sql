-- 進行中場次 POS 開單:pos_orders / pos_order_items / guard_slot_bookings。
-- 手動貼進 Supabase SQL Editor 跑一次即可(可重複安全執行)。金額一律以「萬」為單位的整數儲存。
--
-- ⚠️ 本檔會「先 DROP 再重建」這三張表,以對齊前端 SessionPOS 使用的欄位。
--    這三張表若已有資料會被清掉(POS 尚未上線,通常為空,可安全執行)。
--    若你想保留舊表資料,請先備份或把舊欄位貼給我對齊,不要跑本檔。
drop table if exists public.guard_slot_bookings cascade;
drop table if exists public.pos_order_items     cascade;
drop table if exists public.pos_orders          cascade;

-- 訂單:一次結帳一筆。指名場帶本單犯人名稱 customer_name;集體場為 null。結帳即 paid=true。
create table public.pos_orders (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  customer_name text,
  paid         boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists pos_orders_session_idx on public.pos_orders(session_id);

-- 訂單品項:一列一項。item_type: signup/visit/polaroid/portrait/nominate/entry。
create table public.pos_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.pos_orders(id) on delete cascade,
  session_id      uuid not null references public.sessions(id) on delete cascade,
  item_type       text not null,
  person_name     text,                                   -- 服務對象/犯人名稱
  target_guard_id uuid references public.profiles(id) on delete set null,
  qty             integer,                                -- 拍立得張數;其餘 null(無數量概念)
  with_signature  boolean not null default false,         -- 拍立得加購簽繪
  amount          integer not null default 0,             -- 該列總額(萬)
  visitor_name    text,                                   -- 互動探監:探監人
  message         text,                                   -- 互動探監:留言
  interaction_note text,                                  -- 互動探監:互動內容
  supervise       boolean not null default false,         -- 臨時報名:是否指定監督
  slot_times      jsonb not null default '[]'::jsonb,     -- 臨時指定:選定時格 index 陣列
  status_interact boolean not null default false,         -- 核對:互動
  status_photo    boolean not null default false,         -- 核對:合照
  status_polaroid boolean not null default false,         -- 核對:拍立得
  created_at      timestamptz not null default now()
);
create index if not exists pos_order_items_session_idx on public.pos_order_items(session_id);
create index if not exists pos_order_items_guard_idx   on public.pos_order_items(target_guard_id);

-- 指名時格占用(POS 臨時指定於結帳時寫入;官網預約仍走 bookings.requested_slots,判斷占用時兩者都查)。
create table public.guard_slot_bookings (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  guard_id      uuid not null references public.profiles(id) on delete cascade,
  slot_index    smallint not null,
  order_item_id uuid references public.pos_order_items(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists guard_slot_bookings_session_idx on public.guard_slot_bookings(session_id);
create unique index if not exists guard_slot_bookings_uniq on public.guard_slot_bookings(session_id, guard_id, slot_index);

-- RLS:POS 為典獄長操作,一律限 is_warden()。
alter table public.pos_orders          enable row level security;
alter table public.pos_order_items     enable row level security;
alter table public.guard_slot_bookings enable row level security;
drop policy if exists pos_orders_warden          on public.pos_orders;
drop policy if exists pos_order_items_warden      on public.pos_order_items;
drop policy if exists guard_slot_bookings_warden  on public.guard_slot_bookings;
create policy pos_orders_warden          on public.pos_orders          for all using (is_warden()) with check (is_warden());
create policy pos_order_items_warden      on public.pos_order_items      for all using (is_warden()) with check (is_warden());
create policy guard_slot_bookings_warden  on public.guard_slot_bookings  for all using (is_warden()) with check (is_warden());
