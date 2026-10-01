-- =====================================================================
-- 0124: rename_core_entity() was hitting "canceling statement due to
-- statement timeout" for a real Admin (client_admin) on Prof Toko
-- Online's real data volume — reported as "can edit, but can't save"
-- with no earlier error surfaced (0123's own UI fix is what made the
-- actual error visible at all).
--
-- The function runs several UPDATEs across sales_rows/ad_groups/etc.
-- (the SAME tables the normal upload pipeline can touch heavily) and
-- then calls refresh_dashboard_rollup()/refresh_ads_rollup(), which
-- already carry their OWN `set statement_timeout = '180s'` override
-- (0105/0110) for exactly this reason — but rename_core_entity itself
-- had no such override, so the earlier UPDATE statements (and however
-- the nested calls' GUC interacts with the outer client statement) ran
-- under whatever shorter default applies to a normal logged-in session,
-- not the editor/service-role session this was built and smoke-tested
-- against, which has no timeout at all.
--
-- Fix: give rename_core_entity the same generous allowance the refresh
-- functions it calls already have, rather than relying on their nested
-- override alone to cover the whole call.
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
set statement_timeout = '180s'
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
