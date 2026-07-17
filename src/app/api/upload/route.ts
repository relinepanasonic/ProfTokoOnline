import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapRow, bqCol, type DataSource, type ManualFields } from "@/lib/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

const SOURCES: DataSource[] = ["spos", "ads", "perf"];

// Find the header row index for a sheet by looking for a known column.
// Shopee CSV/xlsx exports often have a metadata preamble before the header.
function findHeaderRow(rows: unknown[][], mustInclude: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (mustInclude.some((m) => cells.some((c) => c.includes(m.toLowerCase())))) {
      return i;
    }
  }
  return 0;
}

// Shopee's Performa export stacks a 1-row date-range summary (with its own
// header) above the real daily-breakdown table, separated by a blank row —
// and repeats the IDENTICAL header text above both. Matching the FIRST
// occurrence (findHeaderRow's behavior) points at the summary table, so only
// that 1 row ever got parsed. Use the LAST header match in the preamble
// instead, which always lands on the real per-day table's header.
function findLastHeaderRow(rows: unknown[][], mustInclude: string[]): number {
  let last = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (mustInclude.some((m) => cells.some((c) => c.includes(m.toLowerCase())))) last = i;
  }
  return last >= 0 ? last : 0;
}

// Header-row hints include the English column names too — Shopee exports in
// whatever language the seller's account uses, and English files have their
// header below a preamble (esp. Ads at ~line 7). Without an English hint the
// detector never finds the header and mis-parses the whole file.
const HEADER_HINTS: Record<DataSource, string[]> = {
  spos: ["Kode Produk", "Produk", "Item ID"],
  ads:  ["Nama Iklan", "Ad Name"],
  perf: ["Total Pengunjung", "Kunjungan", "Visitors (Visit)", "Visitors(Visit)"],
};

export async function POST(req: NextRequest) {
  // 1. Verify the caller and resolve their profile (client + role).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("client_id, role, scope_owner, plan_type, subscription_end")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  const isOwner = profile.role === "branch_manager";
  if (!["superadmin", "client_admin"].includes(profile.role) && !isOwner) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  // Owners may only upload while their subscription is active (has a plan and
  // isn't expired) — expired owners are read-only.
  if (isOwner) {
    const active = !!profile.plan_type
      && (!profile.subscription_end || new Date(profile.subscription_end) > new Date());
    if (!active) return NextResponse.json({ error: "SUBSCRIPTION_INACTIVE" }, { status: 403 });
  }

  // 2. Read the multipart form: a file, its source, target client, manual fields.
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const source = String(form.get("source") || "") as DataSource;
  const manual: ManualFields = JSON.parse(String(form.get("manual") || "{}"));

  // superadmin & client_admin are global → target client comes from the form.
  // Owners are locked to their OWN client, ignoring any client_id in the form.
  const clientId = isOwner ? String(profile.client_id || "") : String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!SOURCES.includes(source))
    return NextResponse.json({ error: "BAD_SOURCE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  // Owners can only upload for a store that belongs to THEIR Owner scope.
  if (isOwner) {
    const store = manual.store_name;
    if (!store) return NextResponse.json({ error: "STORE_REQUIRED" }, { status: 400 });
    const { data: owned } = await supabase
      .from("store_links")
      .select("store_name")
      .eq("client_id", clientId)
      .eq("owner", profile.scope_owner)
      .eq("store_name", store)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: "STORE_NOT_IN_SCOPE" }, { status: 403 });
  }

  // 3. Parse the file (xlsx or csv) with SheetJS.
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });

  if (!matrix.length)
    return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const headerIdx = source === "perf"
    ? findLastHeaderRow(matrix, HEADER_HINTS[source])
    : findHeaderRow(matrix, HEADER_HINTS[source]);
  const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const dataRows = matrix.slice(headerIdx + 1);

  // 4. Build raw row objects keyed by both original header and bqCol form,
  //    then map to typed sales_rows fields.
  const admin = createAdminClient();

  // Create the upload record first so rows can FK to it.
  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source,
      filename: file.name,
      uploaded_by: user.id,
      meta: manual,
    })
    .select("id")
    .single();
  if (upErr || !upload)
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });

  const mapped = dataRows
    .filter((r) => Array.isArray(r) && r.some((c) => c !== "" && c != null))
    .map((r) => {
      const raw: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        const val = (r as unknown[])[i] ?? null;
        // Column-letter key (A, B, ... Z, AA, ...) alongside the header-text
        // key. Some Shopee ads exports don't reliably carry a stable header
        // name for every metric, so a few fields are looked up by their
        // fixed column position instead — see mapRow()'s ads branch.
        raw[`__COL_${XLSX.utils.encode_col(i)}`] = val;
        if (!h) return;
        // Shopee's SPOS "Performa Produk" export repeats the header text
        // "Kode Variasi" on TWO columns (D = the real variant code, G =
        // always "-") — first-occurrence-wins here so the later, always-
        // blank duplicate can't silently clobber the real value. Column-
        // letter keys above are unaffected by this either way.
        if (!(h in raw)) raw[h] = val;
        if (!(bqCol(h) in raw)) raw[bqCol(h)] = val; // also store sanitized key so mapRow's get() hits
      });
      const row = mapRow(source, raw, manual);
      return { ...row, client_id: clientId, upload_id: upload.id };
    });

  // 5. Bulk insert in chunks (Postgres handles large inserts; chunk to stay light).
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const slice = mapped.slice(i, i + CHUNK);
    const { error } = await admin.from("sales_rows").insert(slice);
    if (error) {
      // roll back this upload's rows so we don't leave a partial load
      await admin.from("uploads").delete().eq("id", upload.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  await admin
    .from("uploads")
    .update({ row_count: inserted })
    .eq("id", upload.id);

  // Rebuild the pre-aggregated dashboard rollup once, now that every chunk
  // has landed (migration 0052). This is what keeps the dashboard reading a
  // small, bloat-free summary table instead of scanning all of sales_rows.
  await admin.rpc("refresh_dashboard_rollup");
  // Same reasoning for Ads Performance (migration 0067) — only ads uploads
  // feed ads_rollup, no need to refresh it for spos/perf.
  if (source === "ads") await admin.rpc("refresh_ads_rollup");
  // Modal Product's catalog (migration 0071) — only spos uploads feed it.
  if (source === "spos") await admin.rpc("refresh_product_catalog");

  return NextResponse.json({ ok: true, upload_id: upload.id, rows: inserted });
}
