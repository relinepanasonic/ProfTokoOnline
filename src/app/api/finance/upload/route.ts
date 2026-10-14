import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { parseFinanceMatrix, weekOfMonth, type FinanceRow } from "@/lib/parseFinance";
import { isIncomeSkuMatrix, parseIncomeSkuMatrix, type SkuRow } from "@/lib/parseIncomeSku";

export const runtime = "nodejs";
export const maxDuration = 60;

interface FinanceManual {
  year?: number; bulan?: string;
  pic_client?: string; brand?: string; store_name?: string;
}

// Upload a Shopee "Laporan Penghasilan" (Income) export -> finance_rows.
// Two layouts are accepted: the older one-row-per-order "Income" sheet, and the
// newer "Penghasilan" sheet whose per-product lines also go to finance_sku_rows
// (real per-product costs, see migration 0129 and lib/parseIncomeSku.ts).
// Finance Detail is a Sultan/King feature: superadmin/client_admin/advertiser
// may upload for any client; an Owner (branch_manager) may upload only while
// on an active Sultan or King plan, and only into their own client/store scope.
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
    const active = (profile.plan_type === "sultan" || profile.plan_type === "king")
      && (!profile.subscription_end || new Date(profile.subscription_end) > new Date());
    if (!active) return NextResponse.json({ error: "SUBSCRIPTION_INACTIVE" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const manual: FinanceManual = JSON.parse(String(form.get("manual") || "{}"));
  // superadmin/client_admin/advertiser are global -> target client comes from
  // the form. Owners are locked to their OWN client, ignoring any client_id
  // the form might carry.
  const clientId = isOwner ? String(profile.client_id || "") : String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
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

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName =
    wb.SheetNames.find((n) => n.toLowerCase() === "income") ||
    wb.SheetNames.find((n) => n.toLowerCase() === "penghasilan") ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // Newer layout? Detect on the untouched cell values (numbers stay numbers,
  // so a "-3,510" style number format can never be mis-read).
  const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (!rawMatrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  let parsed: { username: string | null; periodeStart: string | null; periodeEnd: string | null; rows: FinanceRow[] };
  let skuRows: SkuRow[] = [];
  let unreconciled = 0;
  const newLayout = isIncomeSkuMatrix(rawMatrix);
  if (newLayout) {
    const summaryWs = wb.Sheets[wb.SheetNames.find((n) => n.toLowerCase() === "summary") || ""];
    const summary = summaryWs ? XLSX.utils.sheet_to_json<unknown[]>(summaryWs, { header: 1, defval: "" }) : undefined;
    const r = parseIncomeSkuMatrix(rawMatrix, summary);
    parsed = r; skuRows = r.skuRows; unreconciled = r.unreconciled;
  } else {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
    parsed = parseFinanceMatrix(matrix);
  }
  if (!parsed.rows.length) {
    return NextResponse.json({ error: "No order rows found in the Income sheet." }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // New layout only: its per-product lines are summed, so loading the same
  // orders twice would double every cost. Refuse and say how to fix it.
  if (newLayout) {
    const orderNos = parsed.rows.map((r) => r.order_no).filter(Boolean) as string[];
    let dup = 0;
    for (let i = 0; i < orderNos.length; i += 300) {
      let q = admin.from("finance_rows").select("id", { count: "exact", head: true })
        .eq("client_id", clientId).in("order_no", orderNos.slice(i, i + 300));
      if (manual.store_name) q = q.eq("store_name", manual.store_name);
      const { count } = await q;
      dup += count || 0;
    }
    if (dup > 0) {
      return NextResponse.json({
        error: `${dup} of these ${orderNos.length} orders are already uploaded for this store. Delete the earlier upload first (Upload history), then upload this file again.`,
        code: "DUPLICATE_ORDERS", duplicate_orders: dup,
      }, { status: 409 });
    }
  }

  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source: "finance",
      filename: file.name,
      uploaded_by: user.id,
      meta: { ...manual, username: parsed.username, periode_start: parsed.periodeStart, periode_end: parsed.periodeEnd },
    })
    .select("id")
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });
  }

  // Week is no longer manually picked — it's derived per transaction from
  // its own release_date, anchored to the chosen month's 5-week grid
  // (Week 5 naturally spills a few days into the next calendar month).
  const records = parsed.rows.map((r) => ({
    client_id: clientId,
    upload_id: upload.id,
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    week: manual.year && manual.bulan ? weekOfMonth(r.release_date, manual.year, manual.bulan) : null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
    brand: manual.brand ?? null,
    order_no: r.order_no,
    buyer_username: r.buyer_username,
    payment_method: r.payment_method,
    order_date: r.order_date,
    release_date: r.release_date,
    sales: r.sales,
    promotion_cost: r.promotion_cost,
    refund: r.refund,
    delivery_cost: r.delivery_cost,
    affiliate_cost: r.affiliate_cost,
    marketplace_fee: r.marketplace_fee,
    misc: r.misc,
    net_income: r.net_income,
    jasa_kirim: r.jasa_kirim,
    nama_kurir: r.nama_kurir,
    raw: r.raw,
    // only the new layout carries Pajak; omitted otherwise so old-format
    // uploads keep working even before migration 0129 has been applied
    ...(r.pajak !== undefined ? { pajak: r.pajak } : {}),
  }));

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const { error } = await admin.from("finance_rows").insert(slice);
    if (error) {
      await admin.from("uploads").delete().eq("id", upload.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  // Per-product lines (new layout) -> finance_sku_rows, same dimensions as the orders.
  let skuInserted = 0;
  if (skuRows.length) {
    const skuRecords = skuRows.map((s) => ({
      client_id: clientId,
      upload_id: upload.id,
      year: manual.year ?? null,
      month: manual.bulan ?? null,
      week: manual.year && manual.bulan ? weekOfMonth(s.release_date, manual.year, manual.bulan) : null,
      store_name: manual.store_name ?? null,
      pic_client: manual.pic_client ?? null,
      brand: manual.brand ?? null,
      ...s,
    }));
    for (let i = 0; i < skuRecords.length; i += CHUNK) {
      const slice = skuRecords.slice(i, i + CHUNK);
      const { error } = await admin.from("finance_sku_rows").insert(slice);
      if (error) {
        await admin.from("uploads").delete().eq("id", upload.id); // cascades finance_rows + finance_sku_rows
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      skuInserted += slice.length;
    }
  }

  await admin.from("uploads").update({ row_count: inserted }).eq("id", upload.id);

  return NextResponse.json({
    ok: true, upload_id: upload.id, rows: inserted,
    ...(newLayout ? { layout: "penghasilan", product_lines: skuInserted, unreconciled_orders: unreconciled } : {}),
  });
}
