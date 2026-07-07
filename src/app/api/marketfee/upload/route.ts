import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { parseMarketFeeMatrix, marketFeeKey, EDITABLE_FEE_FIELDS, type MarketFeeRow } from "@/lib/parseMarketFee";

export const runtime = "nodejs";
export const maxDuration = 60;

type StoredFee = MarketFeeRow & { id: number };

// Upload the "Market Place Fee" list (CSV or Excel) -> market_fees.
// Diffs against whatever's already stored so only ACTUAL value changes on
// existing items get logged (month + who) — new items just get inserted,
// nothing to diff against yet.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("client_id, role, display_name, username").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (profile.role !== "superadmin" && profile.role !== "client_admin") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const clientId = String(form.get("client_id") || "");
  const month = String(form.get("month") || "").trim();

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });
  if (!month) return NextResponse.json({ error: "NO_MONTH" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === "market place fee") || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  if (!matrix.length) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const parsed = parseMarketFeeMatrix(matrix);
  if (!parsed.length) {
    return NextResponse.json({ error: "No fee rows found — expected Category/Sub Category/.../Platform Fee columns." }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Load every existing row for this client (paginated — PostgREST caps a
  // plain select() at 1000, and this table has 2800+ rows).
  const existingByKey = new Map<string, StoredFee>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("market_fees")
      .select(`id, category, sub_category, jenis_product, platform, jenis_toko, ${EDITABLE_FEE_FIELDS.join(",")}`)
      .eq("client_id", clientId)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data as unknown as StoredFee[]) || []) existingByKey.set(marketFeeKey(row), row);
    if (!data || data.length < PAGE) break;
  }

  const editorName = profile.display_name || profile.username || "Unknown";
  const logEntries: Record<string, unknown>[] = [];
  let newItems = 0;

  for (const row of parsed) {
    const existing = existingByKey.get(marketFeeKey(row));
    if (!existing) { newItems++; continue; }
    for (const field of EDITABLE_FEE_FIELDS) {
      const oldVal = existing[field];
      const newVal = row[field];
      if (oldVal !== newVal) {
        logEntries.push({
          client_id: clientId, market_fee_id: existing.id, field_name: field,
          old_value: oldVal, new_value: newVal, month, edited_by: user.id, edited_by_name: editorName,
        });
      }
    }
  }

  const upsertRows = parsed.map((r) => ({
    client_id: clientId, ...r,
    updated_at: new Date().toISOString(), updated_by: user.id, updated_month: month,
  }));

  const CHUNK = 500;
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const { error } = await admin.from("market_fees").upsert(upsertRows.slice(i, i + CHUNK), {
      onConflict: "client_id,category,sub_category,jenis_product,platform,jenis_toko",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  for (let i = 0; i < logEntries.length; i += CHUNK) {
    const { error } = await admin.from("market_fee_log").insert(logEntries.slice(i, i + CHUNK));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("uploads").insert({
    client_id: clientId, source: "market_fee", filename: file.name,
    uploaded_by: user.id, row_count: parsed.length, meta: { month },
  });

  return NextResponse.json({ ok: true, rows: parsed.length, changed: logEntries.length, new_items: newItems });
}
