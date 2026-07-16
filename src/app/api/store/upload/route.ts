import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { parseOrdersMatrix } from "@/lib/parseOrders";
import { weekOfMonth } from "@/lib/parseFinance";

export const runtime = "nodejs";
export const maxDuration = 60;

interface OrdersManual {
  year?: number; bulan?: string;
  pic_client?: string; brand?: string; store_name?: string;
}

// Upload a Shopee "Order.completed" (order-level) export -> order_rows.
// Operational Performance is a Sultan/King feature — same gate as Finance
// Detail's /api/finance/upload (see the comment there for the full rule).
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
  const manual: OrdersManual = JSON.parse(String(form.get("manual") || "{}"));
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

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "orders") || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  if (!matrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const parsedRows = parseOrdersMatrix(matrix);
  if (!parsedRows.length) {
    return NextResponse.json({ error: "No order rows found — is this a Shopee Order.completed export?" }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: upload, error: upErr } = await admin
    .from("uploads")
    .insert({
      client_id: clientId,
      source: "orders",
      filename: file.name,
      uploaded_by: user.id,
      meta: { ...manual },
    })
    .select("id")
    .single();
  if (upErr || !upload) {
    return NextResponse.json({ error: upErr?.message || "UPLOAD_FAIL" }, { status: 500 });
  }

  // Week is derived per order from its own completion date, anchored to the
  // chosen month's 5-week grid — same convention as Detail Keuangan.
  const records = parsedRows.map((r) => ({
    client_id: clientId,
    upload_id: upload.id,
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    week: manual.year && manual.bulan && r.completed_at
      ? weekOfMonth(r.completed_at.slice(0, 10), manual.year, manual.bulan)
      : null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
    brand: manual.brand ?? null,
    order_no: r.order_no,
    order_type: r.order_type,
    order_status: r.order_status,
    cancel_return_status: r.cancel_return_status,
    tracking_no: r.tracking_no,
    shipping_option: r.shipping_option,
    ship_deadline: r.ship_deadline,
    order_created_at: r.order_created_at,
    paid_at: r.paid_at,
    payment_method: r.payment_method,
    product_name: r.product_name,
    variant_name: r.variant_name,
    qty: r.qty,
    returned_qty: r.returned_qty,
    total_payment: r.total_payment,
    buyer_username: r.buyer_username,
    city: r.city,
    province: r.province,
    completed_at: r.completed_at,
    raw: r.raw,
  }));

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const slice = records.slice(i, i + CHUNK);
    const { error } = await admin.from("order_rows").insert(slice);
    if (error) {
      await admin.from("uploads").delete().eq("id", upload.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    inserted += slice.length;
  }

  await admin.from("uploads").update({ row_count: inserted }).eq("id", upload.id);

  return NextResponse.json({ ok: true, upload_id: upload.id, rows: inserted });
}
