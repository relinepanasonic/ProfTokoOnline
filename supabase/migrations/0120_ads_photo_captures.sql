-- =====================================================================
-- 0120: Ads Photo Captures — Prof Performance > Advertising.
--
-- Staff (Superadmin/Advertiser only — NOT client_admin, matching that
-- sub-page's own access) upload a screenshot of Shopee's "Iklan Produk
-- Otomatis" table; the browser OCRs it client-side (tesseract.js — no AI
-- vision API, no per-request billing) and staff reviews/corrects the
-- extracted rows before saving. Table-layout OCR on a screenshot with
-- colored deltas, thumbnails, and multi-line cells is inherently
-- imperfect without a vision model, so the review step is not optional
-- polish — it's the actual accuracy mechanism here.
--
-- ads_photo_captures  — one row per uploaded image (metadata + storage path)
-- ads_photo_capture_items — one row per extracted "Iklan Produk" line
--   (Iklan Dilihat=views, Jumlah Klik=clicks, Biaya Iklan=ad_cost,
--    Penjualan=sales, Konversi=conversion, Prod Terjual=items_sold)
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('ads-captures', 'ads-captures', false)
on conflict (id) do nothing;

-- Path convention: "<client_id>/<capture_id>.<ext>" — folder-prefixed by
-- client_id so RLS can scope access the same way every other table here
-- does, without a second lookup.
drop policy if exists ads_captures_staff_all on storage.objects;
create policy ads_captures_staff_all on storage.objects
  for all using (
    bucket_id = 'ads-captures'
    and (
      (select my_role())::text = 'superadmin'
      or ((select my_role())::text = 'advertiser' and (storage.foldername(name))[1] = (select my_client_id())::text)
    )
  )
  with check (
    bucket_id = 'ads-captures'
    and (
      (select my_role())::text = 'superadmin'
      or ((select my_role())::text = 'advertiser' and (storage.foldername(name))[1] = (select my_client_id())::text)
    )
  );

create table if not exists ads_photo_captures (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  owner       text,
  brand       text,
  store_name  text,
  year        int,
  month       text,
  image_path  text not null,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ads_photo_captures_client_idx on ads_photo_captures (client_id, year, month);

create table if not exists ads_photo_capture_items (
  id           uuid primary key default gen_random_uuid(),
  capture_id   uuid not null references ads_photo_captures(id) on delete cascade,
  -- Denormalized off the parent capture (same convention as dashboard_
  -- rollup.owner etc.) so this page's filter bar can query items directly
  -- without joining back to the capture on every request.
  client_id    uuid not null references clients(id) on delete cascade,
  owner        text,
  brand        text,
  store_name   text,
  year         int,
  month        text,
  product_name text not null,
  views        numeric,
  clicks       numeric,
  ad_cost      numeric,
  sales        numeric,
  conversion   numeric,
  items_sold   numeric,
  created_at   timestamptz not null default now()
);
create index if not exists ads_photo_capture_items_client_idx  on ads_photo_capture_items (client_id, year, month);
create index if not exists ads_photo_capture_items_capture_idx on ads_photo_capture_items (capture_id);

alter table ads_photo_captures      enable row level security;
alter table ads_photo_capture_items enable row level security;

drop policy if exists ads_photo_captures_staff_all on ads_photo_captures;
create policy ads_photo_captures_staff_all on ads_photo_captures
  for all using (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'advertiser' and client_id = (select my_client_id()))
  )
  with check (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'advertiser' and client_id = (select my_client_id()))
  );

drop policy if exists ads_photo_capture_items_staff_all on ads_photo_capture_items;
create policy ads_photo_capture_items_staff_all on ads_photo_capture_items
  for all using (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'advertiser' and client_id = (select my_client_id()))
  )
  with check (
    (select my_role())::text = 'superadmin'
    or ((select my_role())::text = 'advertiser' and client_id = (select my_client_id()))
  );

notify pgrst, 'reload config';
