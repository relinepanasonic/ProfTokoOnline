import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { parseAdGroupMatrix, type AdGroupManual } from "@/lib/parseAdGroup";

export const runtime = "nodejs";
export const maxDuration = 60;

// Upload a single Shopee "Data Grup Iklan" file -> ad_groups rows.
// Allowed callers: superadmin, client_admin, advertiser.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("client_id, role").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (!["superadmin", "client_admin", "advertiser"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: AdGroupManual = JSON.parse(String(form.get("manual") || "{}"));
  const clientId = String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

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
  const adsLevel = manual.ads_level || null;

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

  const { error: insErr } = await admin.from("ad_groups").insert(records);
  if (insErr) {
    await admin.from("uploads").delete().eq("id", upload.id);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await admin.from("uploads").update({ row_count: records.length }).eq("id", upload.id);

  return NextResponse.json({
    ok: true,
    upload_id: upload.id,
    rows: records.length,
    grup_iklan: parsed.grupIklan,
  });
}
