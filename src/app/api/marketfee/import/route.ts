import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MONTH_LIST = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// Header names exactly as they appear in the source Google Sheet's
// "Market Place Fee" tab — matched by name (not fixed column index) so a
// stray leading blank column or reordered export doesn't break parsing.
const HEADER_MAP: { header: string; field: string; kind: "text" | "pct" | "rp" }[] = [
  { header: "Category", field: "category", kind: "text" },
  { header: "Sub Category", field: "sub_category", kind: "text" },
  { header: "Jenis Product", field: "jenis_product", kind: "text" },
  { header: "Platform", field: "platform", kind: "text" },
  { header: "Jenis Toko", field: "jenis_toko", kind: "text" },
  { header: "Platform Fee", field: "platform_fee_pct", kind: "pct" },
  { header: "Biaya Proses Pesanan", field: "biaya_proses_pesanan_rp", kind: "rp" },
  { header: "Biaya Layanan Mall", field: "biaya_layanan_mall_pct", kind: "pct" },
  { header: "Kategori Kirim", field: "kategori_kirim", kind: "text" },
  { header: "Min Gratis Ongkir Uk Biasa", field: "min_gratis_ongkir_biasa_pct", kind: "pct" },
  { header: "Max Gratis Ongkir Uk Biasa", field: "max_gratis_ongkir_biasa_rp", kind: "rp" },
  { header: "Min Gratis Ongkir Uk Khusus", field: "min_gratis_ongkir_khusus_pct", kind: "pct" },
  { header: "Max Gratis Ongkir Uk Khusus", field: "max_gratis_ongkir_khusus_rp", kind: "rp" },
  { header: "Min Promo Xtra", field: "min_promo_xtra_pct", kind: "pct" },
  { header: "Max Promo Xtra", field: "max_promo_xtra_rp", kind: "rp" }, // Rp cap, not a percent
  { header: "Spay Later Xtra 3 mo", field: "spaylater_xtra_3mo_pct", kind: "pct" },
  { header: "Spay Later Xtra 6 mo", field: "spaylater_xtra_6mo_pct", kind: "pct" },
];

// CSV cells that LOOK like a percent/currency get auto-parsed by SheetJS
// into a raw number rather than kept as formatted text (e.g. "9.00%"
// arrives as the JS number 0.09, a fraction) — so a plain string-replace
// parser silently under-scales every percentage by 100x. Numbers must be
// scaled explicitly; only genuine leftover text needs the %/Rp stripped.
function parsePct(v: unknown): number {
  if (typeof v === "number") return v * 100;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace("%", "").trim());
  if (!Number.isFinite(n)) return 0;
  return s.includes("%") ? n : n * 100;
}
function parseRp(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/rp/i, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    if (cells.includes("Category") && cells.includes("Platform")) return i;
  }
  return -1;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, display_name, email, client_id").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });

  const admin = createAdminClient();
  const { data: cs } = await admin.from("clients").select("id").order("created_at").limit(1);
  const clientId = profile.client_id || (cs as { id: string }[] | null)?.[0]?.id;
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const headerIdx = findHeaderRow(matrix);
  if (headerIdx === -1) return NextResponse.json({ error: "Couldn't find a header row with Category/Platform columns" }, { status: 400 });

  const header = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const colIdx = (name: string) => header.findIndex((h) => h === name || h.startsWith(name));
  const editedBy = profile.display_name || profile.email?.split("@")[0] || "Admin";
  const editedMonth = `${MONTH_LIST[new Date().getMonth()]} ${new Date().getFullYear()}`;

  // Text fields normalize blank -> "" (not null). The upsert below matches
  // existing rows via ON CONFLICT on (category, sub_category, jenis_product,
  // platform, jenis_toko) -- Postgres treats every NULL as distinct from
  // every other NULL, so a blank sub_category/jenis_product/jenis_toko would
  // never match an existing blank row on conflict and would silently INSERT
  // a duplicate instead of overwriting it. "" is a real, comparable value,
  // so re-importing the same sheet always updates the same rows in place.
  const mapped = matrix.slice(headerIdx + 1)
    .filter((r) => String(r[colIdx("Category")] ?? "").trim())
    .map((r) => {
      const row: Record<string, unknown> = { client_id: clientId, updated_by: editedBy, updated_month: editedMonth };
      for (const h of HEADER_MAP) {
        const idx = colIdx(h.header);
        const raw = idx === -1 ? "" : r[idx];
        if (h.kind === "text") row[h.field] = String(raw ?? "").trim();
        else if (h.kind === "pct") row[h.field] = parsePct(raw);
        else row[h.field] = parseRp(raw);
      }
      if (!row.platform) row.platform = "Shopee";
      return row;
    });

  if (!mapped.length) return NextResponse.json({ error: "No data rows found under the header" }, { status: 400 });

  const numericFields = HEADER_MAP.filter((h) => h.kind !== "text").map((h) => h.field);
  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const slice = mapped.slice(i, i + CHUNK);
    const { data: upserted, error } = await admin.from("market_fees").upsert(slice, {
      onConflict: "client_id,category,sub_category,jenis_product,platform,jenis_toko",
    }).select("id, " + numericFields.join(", "));
    if (error) return NextResponse.json({ error: error.message, imported }, { status: 500 });
    imported += slice.length;

    const logs = ((upserted || []) as unknown as Record<string, unknown>[]).map((row) => {
      const entry: Record<string, unknown> = { fee_id: row.id, edited_by: editedBy, edited_month: editedMonth };
      for (const f of numericFields) entry[f] = row[f];
      return entry;
    });
    if (logs.length) await admin.from("market_fee_edits").insert(logs);
  }

  return NextResponse.json({ ok: true, imported });
}
