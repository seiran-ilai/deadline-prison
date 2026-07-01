-- POS 訂單備註 + 預約犯人「DC 預約頻道建立」確認。手動貼進 Supabase SQL Editor 跑一次(可重複安全執行)。
-- pos_orders.note:結帳時可填一句備註,今日營業總表每單可查看。
-- bookings.dc_channel_ready:預約犯人的確認項目(是否已建立 DC 預約頻道)。

alter table public.pos_orders
  add column if not exists note text;

alter table public.bookings
  add column if not exists dc_channel_ready boolean not null default false;
