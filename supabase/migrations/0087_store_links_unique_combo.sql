-- =====================================================================
-- 0087: Unique composite index on store_links (client_id, owner, brand,
-- store_name).
--
-- Backs the new "select or create" Brand/Store comboboxes on the Upload
-- page: when a user types a brand/store that doesn't exist yet, the
-- frontend upserts the (owner, brand, store_name) combo into store_links
-- BEFORE the upload POST (so the /api/upload STORE_NOT_IN_SCOPE guard
-- passes and the value shows up in the dropdown next time). The upsert
-- uses onConflict on these four columns and must be idempotent — hence a
-- unique index.
--
-- Postgres treats NULLs as distinct in a plain unique index, so the
-- brand-level rows sync writes (store_name = null) never collide; only
-- fully-concrete store rows (what the combobox inserts) are de-duped,
-- which is exactly what we want.
--
-- Existing rows are de-duplicated first (null-safe, keeping the earliest
-- per combo) so the unique index can be created cleanly regardless of
-- history. Safe to re-run.
-- =====================================================================

delete from store_links
where id in (
  select id from (
    select id, row_number() over (
      partition by client_id, coalesce(owner,''), coalesce(brand,''), coalesce(store_name,'')
      order by created_at, id
    ) rn
    from store_links
  ) t where rn > 1
);

create unique index if not exists store_links_client_owner_brand_store_uidx
  on store_links (client_id, owner, brand, store_name);

notify pgrst, 'reload config';
