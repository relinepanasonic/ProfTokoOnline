import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { parseAdGroupMatrix, type AdGroupManual } from "@/lib/parseAdGroup";

export const runtime = "nodejs";
export const maxDuration = 60;

// The Group export's title names the level ("...Laporan Grup Hero...", etc.)
// — used as a fallback when the caller (the simplified "Upload Here" page's
// Group Ads Performa card, which has no level dropdown) doesn't send
// manual.ads_level explicitly. "Upload by Admin"'s UploadIklan widget still
// sends an explicit level, which always takes precedence over this guess.
function inferGroupLevel(grupIklan: string | null): string {
  const g = (grupIklan || "").toLowerCase();
  if (g.includes("gmv max")) return "incubation";
  if (g.includes("hero")) return "hero";
  if (g.includes("low")) return "low_conversion";
  return "regular";
}

// Upload a single Shopee "Data Grup Iklan" / Shop GMV Max file -> ad_groups
// rows. "All Level" feature — every plan (Lapak/Sultan/King) may upload, same
// as the core SPOS/Ads/Performa flow (/api/upload); only the client/store
// scope is restricted for Owners.
export async function POST(req: NextRequest) {
  try {
    return await handleAdsGroupUpload(req);
  } catch (e) {
    // Guarantee JSON on every exit path — an uncaught throw would otherwise
    // fall through to Next.js's default error page (plain text/HTML), which
    // breaks every caller's `await res.json()`.
    console.error("Ads-group upload route crashed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "An error occurred" }, { status: 500 });
  }
}

async function handleAdsGroupUpload(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("client_id, role, scope_owner").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  const isOwner = profile.role === "branch_manager";
  if (!["superadmin", "client_admin", "advertiser"].includes(profile.role) && !isOwner) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: AdGroupManual = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = isOwner ? String(profile.client_id || "") : String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

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

  // parse
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  if (!matrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const parsed = parseAdGroupMatrix(matrix);
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "No ad-group rows found in this file." }, { status: 400 });
  }

  // Grup Iklan: manual override wins, else the name parsed from the file title.
  const grupIklan = manual.grup_iklan?.trim() || parsed.grupIklan;
  const adsLevel = manual.ads_level || inferGroupLevel(parsed.grupIklan);

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // uploads audit row (source 'ads_group')
  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source: "ads_group",
      filename: file.name,
      uploaded_by: user.id,
      meta: {
        ...manual,
        grup_iklan: grupIklan,
        ads_level: adsLevel,
        periode_start: parsed.periodeStart,
        periode_end: parsed.periodeEnd,
      },
    })
    .select("id")
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });
  }

  const records = parsed.rows.map((r) => ({
    client_id: clientId,
    upload_id: upload.id,
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    week: manual.week ?? null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
    brand: manual.brand ?? null,
    grup_iklan: grupIklan,
    ads_level: adsLevel,
    level: r.level,
    item_name: r.item_name,
    kode_produk: r.kode_produk,
    dilihat: r.dilihat,
    klik: r.klik,
    konversi: r.konversi,
    konversi_langsung: r.konversi_langsung,
    produk_terjual: r.produk_terjual,
    terjual_langsung: r.terjual_langsung,
    omzet: r.omzet,
    penjualan_langsung: r.penjualan_langsung,
    biaya: r.biaya,
    roas: r.roas,
    roas_langsung: r.roas_langsung,
    periode_start: parsed.periodeStart,
    periode_end: parsed.periodeEnd,
    raw: r.raw,
  }));

  // Idempotent: re-uploading the same ad group for the same period REPLACES
  // it instead of appending a duplicate copy (see migration 0106, which
  // cleans up the duplicates the old append-only behavior accumulated).
  // Keyed by grup_iklan as well as the period/store, so the several groups
  // that legitimately share one week don't delete each other.
  if (manual.year != null && manual.bulan && manual.week && manual.store_name && grupIklan) {
    const { error: delErr } = await admin
      .from("ad_groups")
      .delete()
      .eq("client_id", clientId)
      .eq("year", manual.year)
      .eq("month", manual.bulan)
      .eq("week", manual.week)
      .eq("store_name", manual.store_name)
      .eq("grup_iklan", grupIklan);
    if (delErr) {
      await admin.from("uploads").delete().eq("id", upload.id);
      return NextResponse.json({ error: `Could not clear previous upload: ${delErr.message}` }, { status: 500 });
    }
  }

  const { error: insErr } = await admin.from("ad_groups").insert(records);
  if (insErr) {
    await admin.from("uploads").delete().eq("id", upload.id);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await admin.from("uploads").update({ row_count: records.length }).eq("id", upload.id);

  // Rebuild the pre-aggregated ads rollup (migration 0067) — same reasoning
  // as refresh_dashboard_rollup: keeps Ads Performance reading a small
  // summary table instead of scanning all of ad_groups under RLS. Error is
  // surfaced (not silently discarded) — see migration 0102 for the exact
  // shape of bug this class of silent failure caused on the Dashboard side.
  // Slice-scoped (migration 0107) — recomputes only this week/store, not the
  // client's whole ad history. See /api/upload for the full reasoning.
  const canSlice = manual.year != null && manual.bulan && manual.week && manual.store_name;
  const { error: adsErr } = canSlice
    ? await admin.rpc("refresh_ads_rollup_slice", {
        p_client_id: clientId, p_year: manual.year,
        p_month: manual.bulan, p_week: manual.week, p_store_name: manual.store_name,
      })
    : await admin.rpc("refresh_ads_rollup", { p_client_id: clientId });
  if (adsErr) console.error("refresh_ads_rollup failed:", adsErr);

  return NextResponse.json({
    ok: true,
    upload_id: upload.id,
    rows: records.length,
    grup_iklan: parsed.grupIklan,
    ...(adsErr ? { rollup_warning: adsErr.message } : {}),
  });
}
