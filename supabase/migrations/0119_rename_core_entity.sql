-- =====================================================================
-- 0119: rename_core_entity() — fix a typo'd Owner/Brand/Store name in
-- Core List without deleting it (deleting would orphan every historical
-- upload row tagged with that name — the whole reason this RPC exists
-- instead of "just delete and re-add").
--
-- Owner/Brand/Store names are plain text, matched (not a real foreign
-- key) across a wide set of tables built up over this project:
--   - master_data.value           — the Core List entry itself
--   - store_links.owner/brand/store_name — the hierarchy links
--   - sales_rows.store_name/brand — raw upload data (owner has no column
--     here; it's resolved via store_links at rollup-refresh time, so an
--     owner rename never needs to touch sales_rows)
--   - ad_groups.store_name/pic_client/brand — raw Ads Group upload data
--   - price_calc_items.owner/store_name     — Massive Calculator rows
--   - profiles.scope_owner/scope_store      — THE value that actually
--     drives an Owner/Store login's RLS access; missing this one would
--     lock that login out of their own (renamed) data immediately
--   - invites.owner_name/store_name         — best-effort, for any
--     still-pending unused invite link
-- dashboard_rollup / ads_rollup / dashboard_month_completeness are NOT
-- touched directly — they're rebuilt from the tables above by the
-- existing refresh_dashboard_rollup()/refresh_ads_rollup() at the end,
-- same as every upload already does.
--
-- security definer + an internal role/client check (not just "runs as
-- caller") because it needs to reach profiles.scope_owner, which client_
-- admin cannot write directly under profiles_admin_all's RLS shape.
-- =====================================================================

create or replace function rename_core_entity(
  p_client_id uuid,
  p_kind      text,   -- 'owner' | 'brand' | 'store'
  p_old_value text,
  p_new_value text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := my_role()::text;
begin
  if v_role not in ('superadmin', 'client_admin') then
    raise exception 'not allowed';
  end if;
  if v_role = 'client_admin' and p_client_id <> my_client_id() then
    raise exception 'not allowed';
  end if;
  if p_kind not in ('owner', 'brand', 'store') then
    raise exception 'invalid kind: %', p_kind;
  end if;
  p_old_value := trim(p_old_value);
  p_new_value := trim(p_new_value);
  if p_new_value = '' or p_old_value = p_new_value then
    raise exception 'invalid new value';
  end if;

  update master_data
     set value = p_new_value
   where client_id = p_client_id and kind = p_kind and value = p_old_value;

  if p_kind = 'owner' then
    update store_links set owner = p_new_value
     where client_id = p_client_id and owner = p_old_value;
    update ad_groups set pic_client = p_new_value
     where client_id = p_client_id and pic_client = p_old_value;
    update price_calc_items set owner = p_new_value
     where client_id = p_client_id and owner = p_old_value;
    update profiles set scope_owner = p_new_value
     where client_id = p_client_id and scope_owner = p_old_value;
    update invites set owner_name = p_new_value
     where client_id = p_client_id and owner_name = p_old_value and used_at is null;

  elsif p_kind = 'brand' then
    update store_links set brand = p_new_value
     where client_id = p_client_id and brand = p_old_value;
    update sales_rows set brand = p_new_value
     where client_id = p_client_id and brand = p_old_value;
    update ad_groups set brand = p_new_value
     where client_id = p_client_id and brand = p_old_value;

  elsif p_kind = 'store' then
    update store_links set store_name = p_new_value
     where client_id = p_client_id and store_name = p_old_value;
    update sales_rows set store_name = p_new_value
     where client_id = p_client_id and store_name = p_old_value;
    update ad_groups set store_name = p_new_value
     where client_id = p_client_id and store_name = p_old_value;
    update price_calc_items set store_name = p_new_value
     where client_id = p_client_id and store_name = p_old_value;
    update profiles set scope_store = p_new_value
     where client_id = p_client_id and scope_store = p_old_value;
    update invites set store_name = p_new_value
     where client_id = p_client_id and store_name = p_old_value and used_at is null;
  end if;

  -- Rebuild every table derived from the raw data just renamed above,
  -- same as a normal upload does.
  perform refresh_dashboard_rollup(p_client_id);
  perform refresh_ads_rollup(p_client_id);
end;
$$;

notify pgrst, 'reload config';
