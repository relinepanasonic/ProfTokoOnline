import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mapRow, bqCol, type ManualFields } from "@/lib/parse";
import { parseAdGroupMatrix, type AdGroupManual } from "@/lib/parseAdGroup";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Upload Here" (the simplified Owner-facing page) has ONE Ads Performance
// drop zone instead of three (Ads Performa / Inkubasi Performa / Group
// Performa) — the file's own title row already says which report it is, so
// we sniff it instead of asking the uploader to pick:
//   "Semua Laporan Iklan CPC - Shopee Indonesia"  -> core Ads Performa (sales_rows)
//   "Ad Group - Shopee Indonesia"                 -> Group Performa (ad_groups)
//   "Shop GMV Max - Shopee Indonesia"              -> Inkubasi Performa (ad_groups, ads_level=incubation)
type AdsFileType = "ads" | "group" | "incubation";

function detectType(matrix: unknown[][]): AdsFileType {
  const title = String(matrix[0]?.[0] ?? "").toLowerCase();
  if (title.includes("gmv max")) return "incubation";
  if (title.includes("ad group") || title.includes("grup iklan")) return "group";
  return "ads";
}

// The Group export's title names the level ("...Laporan Grup Hero...", etc.)
// — reuse that text to infer ads_level instead of asking the uploader.
function inferGroupLevel(grupIklan: string | null): string {
  const g = (grupIklan || "").toLowerCase();
  if (g.includes("hero")) return "hero";
  if (g.includes("low")) return "low_conversion";
  if (g.includes("independent") || g.includes("regular")) return "regular";
  return "regular";
}

const HEADER_HINTS_ADS = ["Nama Iklan", "Ad Name"];
function findHeaderRow(rows: unknown[][], mustInclude: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (mustInclude.some((m) => cells.some((c) => c.includes(m.toLowerCase())))) return i;
  }
  return 0;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("client_id, role, scope_owner, plan_type, subscription_end").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  const isOwner = profile.role === "branch_manager";
  if (!["superadmin", "client_admin", "advertiser"].includes(profile.role) && !isOwner) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (isOwner) {
    const active = !!profile.plan_type
      && (!profile.subscription_end || new Date(profile.subscription_end) > new Date());
    if (!active) return NextResponse.json({ error: "SUBSCRIPTION_INACTIVE" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: ManualFields & AdGroupManual = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = isOwner ? String(profile.client_id || "") : String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  if (isOwner) {
    const store = manual.store_name;
    if (!store) return NextResponse.json({ error: "STORE_REQUIRED" }, { status: 400 });
    const { data: owned } = await supabase
      .from("store_links").select("store_name")
      .eq("client_id", clientId).eq("owner", profile.scope_owner).eq("store_name", store).maybeSingle();
    if (!owned) return NextResponse.json({ error: "STORE_NOT_IN_SCOPE" }, { status: 403 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  if (!matrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const type = detectType(matrix);
  const admin = createAdminClient();

  if (type === "ads") {
    const headerIdx = findHeaderRow(matrix, HEADER_HINTS_ADS);
    const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
    const dataRows = matrix.slice(headerIdx + 1);

    const { data: upload, error: upErr } = await admin
      .from("uploads")
      .insert({ client_id: clientId, source: "ads", filename: file.name, uploaded_by: user.id, meta: manual })
      .select("id").single();
    if (upErr || !upload) return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });

    const mapped = dataRows
      .filter((r) => Array.isArray(r) && r.some((c) => c !== "" && c != null))
      .map((r) => {
        const raw: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          const val = (r as unknown[])[i] ?? null;
          raw[`__COL_${XLSX.utils.encode_col(i)}`] = val;
          if (!h) return;
          raw[h] = val;
          raw[bqCol(h)] = val;
        });
        const row = mapRow("ads", raw, manual);
        return { ...row, client_id: clientId, upload_id: upload.id };
      });

    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < mapped.length; i += CHUNK) {
      const slice = mapped.slice(i, i + CHUNK);
      const { error } = await admin.from("sales_rows").insert(slice);
      if (error) {
        await admin.from("uploads").delete().eq("id", upload.id);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      inserted += slice.length;
    }
    await admin.from("uploads").update({ row_count: inserted }).eq("id", upload.id);
    await admin.rpc("refresh_dashboard_rollup");
    return NextResponse.json({ ok: true, type, upload_id: upload.id, rows: inserted });
  }

  // type === "group" | "incubation" -> ad_groups (same pipeline as /api/ads-group/upload)
  const parsed = parseAdGroupMatrix(matrix);
  if (!parsed.rows.length) return NextResponse.json({ error: "No ad-group rows found in this file." }, { status: 400 });

  const adsLevel = type === "incubation" ? "incubation" : inferGroupLevel(parsed.grupIklan);
  const grupIklan = manual.grup_iklan?.trim() || parsed.grupIklan;

  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId, source: "ads_group", filename: file.name, uploaded_by: user.id,
      meta: { ...manual, grup_iklan: grupIklan, ads_level: adsLevel, periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd },
    })
    .select("id").single();
  if (upErr || !upload) return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });

  const records = parsed.rows.map((r) => ({
    client_id: clientId, upload_id: upload.id,
    year: manual.year ?? null, month: manual.bulan ?? null, week: manual.week ?? null,
    store_name: manual.store_name ?? null, pic_client: manual.pic_client ?? null, brand: manual.brand ?? null,
    grup_iklan: grupIklan, ads_level: adsLevel, level: r.level,
    item_name: r.item_name, kode_produk: r.kode_produk,
    dilihat: r.dilihat, klik: r.klik, konversi: r.konversi, konversi_langsung: r.konversi_langsung,
    produk_terjual: r.produk_terjual, terjual_langsung: r.terjual_langsung,
    omzet: r.omzet, penjualan_langsung: r.penjualan_langsung, biaya: r.biaya,
    roas: r.roas, roas_langsung: r.roas_langsung,
    periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd, raw: r.raw,
  }));

  const { error: insErr } = await admin.from("ad_groups").insert(records);
  if (insErr) {
    await admin.from("uploads").delete().eq("id", upload.id);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  await admin.from("uploads").update({ row_count: records.length }).eq("id", upload.id);

  return NextResponse.json({ ok: true, type, upload_id: upload.id, rows: records.length, grup_iklan: parsed.grupIklan, ads_level: adsLevel });
}
