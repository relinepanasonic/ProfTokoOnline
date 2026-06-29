-- =====================================================================
-- 0017: Seed Core List for Prof Toko Online
-- Owner → Brand → Store hierarchy + City + Platform
-- Safe to re-run: clears owner/brand/store/platform + store_links first.
-- =====================================================================

DO $$
DECLARE
  cid uuid;
BEGIN
  SELECT id INTO cid FROM clients ORDER BY created_at LIMIT 1;

  IF cid IS NULL THEN
    RAISE EXCEPTION 'No client found. Create a client first.';
  END IF;

  -- Clear existing hierarchy data (keep city rows if already added)
  DELETE FROM store_links WHERE client_id = cid;
  DELETE FROM master_data  WHERE client_id = cid AND kind IN ('owner','brand','store','platform');

  -- Cities
  INSERT INTO master_data (client_id, kind, value) VALUES
    (cid, 'city', 'Jakarta'),
    (cid, 'city', 'Surabaya')
  ON CONFLICT (client_id, kind, value) DO NOTHING;

  -- Owners
  INSERT INTO master_data (client_id, kind, value) VALUES
    (cid, 'owner', 'Yohanes'),
    (cid, 'owner', 'Enrico')
  ON CONFLICT (client_id, kind, value) DO NOTHING;

  -- Brands
  INSERT INTO master_data (client_id, kind, value) VALUES
    (cid, 'brand', 'Nuphy'),
    (cid, 'brand', 'Dicium')
  ON CONFLICT (client_id, kind, value) DO NOTHING;

  -- Stores
  INSERT INTO master_data (client_id, kind, value) VALUES
    (cid, 'store', 'Nuphy Indonesia'),
    (cid, 'store', 'Dicium Parfume')
  ON CONFLICT (client_id, kind, value) DO NOTHING;

  -- Platform
  INSERT INTO master_data (client_id, kind, value) VALUES
    (cid, 'platform', 'Shopee')
  ON CONFLICT (client_id, kind, value) DO NOTHING;

  -- store_links: brand-level rows (owner → brand, no store yet)
  INSERT INTO store_links (client_id, owner, brand, store_name) VALUES
    (cid, 'Yohanes', 'Nuphy',  NULL),
    (cid, 'Enrico',  'Dicium', NULL);

  -- store_links: store-level rows (owner → brand → store)
  INSERT INTO store_links (client_id, owner, brand, store_name) VALUES
    (cid, 'Yohanes', 'Nuphy',  'Nuphy Indonesia'),
    (cid, 'Enrico',  'Dicium', 'Dicium Parfume');

END $$;
