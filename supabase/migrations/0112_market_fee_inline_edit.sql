-- =====================================================================
-- 0112: Add inline editing to the EXISTING Market Place Fee system.
--
-- market_fees/market_fee_log (0038/0039) already exist in production with
-- 2,800+ real rows, a per-field audit log, and a correct upsert-on-import
-- pipeline (/api/marketfee/upload). This migration is purely additive —
-- no DROP, no rename, no column removed — so none of that is touched.
--
-- Adds only what direct inline-cell editing needs on top:
--   1. market_fees.updated_by_name — denormalized display name (mirrors
--      market_fee_log.edited_by_name's existing pattern) so the table can
--      show "who + month" without joining profiles from the client.
--   2. INSERT/DELETE policies for client_admin on market_fees — the
--      existing policies only cover SELECT (read) and UPDATE (single-field
--      edit via update_market_fee_field); the new "Add Fee"/"Delete" row
--      actions need insert/delete too.
--   3. save_market_fee_row() — a NEW atomic multi-field RPC. The existing
--      update_market_fee_field() edits one field per call; saving a row
--      with several changed cells at once by looping it client-side would
--      mean several round trips and a partial-write risk if one call in
--      the middle fails. This RPC takes the whole row in one call, diffs
--      every numeric field server-side, writes ONE update statement plus
--      one batch of log rows, in one transaction. update_market_fee_field
--      itself is untouched — nothing currently calls it, so there's
--      nothing to risk breaking by leaving it exactly as-is.
--
-- kategori_kirim (the one text field in the fee set) is included in the
-- update but NOT in the diff/log: market_fee_log.old_value/new_value are
-- `numeric`, so a text value has nowhere to go in the existing log schema.
-- Widening those columns to text was considered and rejected here — it's
-- unrelated to what inline editing actually needs and it's out of scope
-- for an additive migration; kategori_kirim stays editable, just outside
-- the audit trail, same as it already was for every row before this ships.
-- =====================================================================

alter table market_fees add column if not exists updated_by_name text;

drop policy if exists market_fees_client_insert on market_fees;
create policy market_fees_client_insert on market_fees
  for insert
  with check (client_id = my_client_id() and my_role()::text = 'client_admin');

drop policy if exists market_fees_client_delete on market_fees;
create policy market_fees_client_delete on market_fees
  for delete
  using (client_id = my_client_id() and my_role()::text = 'client_admin');

-- ── update_market_fee_field(): also store the editor's display name ────
-- Same signature, same behavior, byte-for-byte except adding
-- updated_by_name to the UPDATE and RAISE check. Not currently called by
-- any shipped frontend code (the table has always been read-only until
-- this migration), so this is safe to touch.
create or replace function update_market_fee_field(
  p_id      bigint,
  p_field   text,
  p_value   numeric,
  p_month   text
) returns market_fees
language plpgsql
as $$
declare
  allowed text[] := array[
    'platform_fee','biaya_proses_pesanan','biaya_layanan_mall',
    'min_go_biasa','max_go_biasa','min_go_khusus','max_go_khusus',
    'min_promo_xtra','max_promo_xtra','spaylater_3mo','spaylater_6mo'
  ];
  old_val   numeric;
  fee_client uuid;
  editor_name text;
  result market_fees;
begin
  if not (p_field = any(allowed)) then
    raise exception 'field % is not editable', p_field;
  end if;

  select client_id into fee_client from market_fees where id = p_id;
  if fee_client is null or fee_client <> my_client_id() then
    raise exception 'not found';
  end if;

  execute format('select %I from market_fees where id = $1', p_field) into old_val using p_id;
  select coalesce(display_name, username, 'Unknown') into editor_name from profiles where id = auth.uid();

  execute format(
    'update market_fees set %I = $1, updated_at = now(), updated_by = $2, updated_by_name = $3, updated_month = $4 where id = $5',
    p_field
  ) using p_value, auth.uid(), editor_name, p_month, p_id;

  insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
  values (fee_client, p_id, p_field, old_val, p_value, p_month, auth.uid(), editor_name);

  select * into result from market_fees where id = p_id;
  return result;
end;
$$;

-- ── save_market_fee_row(): atomic whole-row save for inline editing ────
-- language plpgsql, NOT security definer — runs as the calling user, so
-- the UPDATE statement inside is still governed by market_fees_client_write
-- (client_admin can only touch their own client_id) exactly like
-- update_market_fee_field already does. Explicit named parameters (one per
-- real column) rather than a jsonb blob: no dynamic SQL, no format()
-- injection surface, and a typo in a param name is a compile-time function
-- signature error instead of a silently-ignored jsonb key.
create or replace function save_market_fee_row(
  p_id                    bigint,
  p_platform_fee          numeric,
  p_biaya_proses_pesanan  numeric,
  p_biaya_layanan_mall    numeric,
  p_kategori_kirim        text,
  p_min_go_biasa          numeric,
  p_max_go_biasa          numeric,
  p_min_go_khusus         numeric,
  p_max_go_khusus         numeric,
  p_min_promo_xtra        numeric,
  p_max_promo_xtra        numeric,
  p_spaylater_3mo         numeric,
  p_spaylater_6mo         numeric,
  p_month                 text
) returns market_fees
language plpgsql
as $$
declare
  fee_client   uuid;
  editor_name  text;
  old          market_fees;
  result       market_fees;
  logs         jsonb := '[]'::jsonb;
begin
  select * into old from market_fees where id = p_id;
  if old.id is null or old.client_id <> my_client_id() then
    raise exception 'not found';
  end if;

  select coalesce(display_name, username, 'Unknown') into editor_name from profiles where id = auth.uid();

  update market_fees set
    platform_fee         = p_platform_fee,
    biaya_proses_pesanan = p_biaya_proses_pesanan,
    biaya_layanan_mall   = p_biaya_layanan_mall,
    kategori_kirim       = p_kategori_kirim,
    min_go_biasa         = p_min_go_biasa,
    max_go_biasa         = p_max_go_biasa,
    min_go_khusus        = p_min_go_khusus,
    max_go_khusus        = p_max_go_khusus,
    min_promo_xtra       = p_min_promo_xtra,
    max_promo_xtra       = p_max_promo_xtra,
    spaylater_3mo        = p_spaylater_3mo,
    spaylater_6mo        = p_spaylater_6mo,
    updated_at           = now(),
    updated_by            = auth.uid(),
    updated_by_name       = editor_name,
    updated_month         = p_month
  where id = p_id;

  -- Log only the numeric fields that actually changed — same "diff, don't
  -- blanket-log" behavior the CSV importer already uses.
  if p_platform_fee is distinct from old.platform_fee then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'platform_fee', old.platform_fee, p_platform_fee, p_month, auth.uid(), editor_name);
  end if;
  if p_biaya_proses_pesanan is distinct from old.biaya_proses_pesanan then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'biaya_proses_pesanan', old.biaya_proses_pesanan, p_biaya_proses_pesanan, p_month, auth.uid(), editor_name);
  end if;
  if p_biaya_layanan_mall is distinct from old.biaya_layanan_mall then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'biaya_layanan_mall', old.biaya_layanan_mall, p_biaya_layanan_mall, p_month, auth.uid(), editor_name);
  end if;
  if p_min_go_biasa is distinct from old.min_go_biasa then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'min_go_biasa', old.min_go_biasa, p_min_go_biasa, p_month, auth.uid(), editor_name);
  end if;
  if p_max_go_biasa is distinct from old.max_go_biasa then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'max_go_biasa', old.max_go_biasa, p_max_go_biasa, p_month, auth.uid(), editor_name);
  end if;
  if p_min_go_khusus is distinct from old.min_go_khusus then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'min_go_khusus', old.min_go_khusus, p_min_go_khusus, p_month, auth.uid(), editor_name);
  end if;
  if p_max_go_khusus is distinct from old.max_go_khusus then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'max_go_khusus', old.max_go_khusus, p_max_go_khusus, p_month, auth.uid(), editor_name);
  end if;
  if p_min_promo_xtra is distinct from old.min_promo_xtra then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'min_promo_xtra', old.min_promo_xtra, p_min_promo_xtra, p_month, auth.uid(), editor_name);
  end if;
  if p_max_promo_xtra is distinct from old.max_promo_xtra then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'max_promo_xtra', old.max_promo_xtra, p_max_promo_xtra, p_month, auth.uid(), editor_name);
  end if;
  if p_spaylater_3mo is distinct from old.spaylater_3mo then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'spaylater_3mo', old.spaylater_3mo, p_spaylater_3mo, p_month, auth.uid(), editor_name);
  end if;
  if p_spaylater_6mo is distinct from old.spaylater_6mo then
    insert into market_fee_log (client_id, market_fee_id, field_name, old_value, new_value, month, edited_by, edited_by_name)
    values (old.client_id, p_id, 'spaylater_6mo', old.spaylater_6mo, p_spaylater_6mo, p_month, auth.uid(), editor_name);
  end if;

  select * into result from market_fees where id = p_id;
  return result;
end;
$$;

grant execute on function save_market_fee_row(
  bigint, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) to authenticated;

notify pgrst, 'reload config';
