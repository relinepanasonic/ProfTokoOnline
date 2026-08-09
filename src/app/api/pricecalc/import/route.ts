import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Header names for the "Massive Calculator" bulk-upload sheet — matched by
// name (not fixed position), same convention as /api/marketfee/import.
const HEADER_MAP: { header: string; field: string; kind: "text" | "num" }[] = [
  { header: "Item Product",   field: "item_name",       kind: "text" },
  { header: "Owner",          field: "owner",           kind: "text" },
  { header: "Store",          field: "store_name",      kind: "text" },
  { header: "Category",       field: "category",        kind: "text" },
  { header: "Sub Category",   field: "sub_category",     kind: "text" },
  { header: "Jenis Product",  field: "jenis_product",    kind: "text" },
  { header: "Platform",       field: "platform",         kind: "text" },
  { header: "Jenis Toko",     field: "jenis_toko",       kind: "text" },
  { header: "Modal Produk",   field: "modal_produk_rp",  kind: "num" },
  { header: "Harga Jual",     field: "harga_jual_rp",    kind: "num" },
  { header: "Berat (Kg)",     field: "weight_kg",        kind: "num" },
  { header: "Volume (cm3)",   field: "volume_cm3",       kind: "num" },
];

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const n = Number(s.replace(/rp/i, "").replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    if (cells.includes("Item Product") && cells.includes("Harga Jual")) return i;
  }
  return -1;
}

// Bulk-append only (no upsert): these are a seller's own working
// calculator rows, not a shared canonical fee-rule table, so there is no
// natural dedup key to upsert on the way market_fees does. Duplicates from
// a re-upload can just be deleted manually from the table.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, client_id, scope_owner").eq("id", user.id).single();
  if (!profile || !["superadmin", "client_admin", "branch_manager"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const isOwnerLogin = profile.role === "branch_manager";

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
  if (headerIdx === -1) return NextResponse.json({ error: "Couldn't find a header row with Item Product/Harga Jual columns" }, { status: 400 });

  const header = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const colIdx = (name: string) => header.findIndex((h) => h === name || h.startsWith(name));

  const mapped = matrix.slice(headerIdx + 1)
    .filter((r) => String(r[colIdx("Item Product")] ?? "").trim())
    .map((r) => {
      const row: Record<string, unknown> = { client_id: clientId };
      for (const h of HEADER_MAP) {
        const idx = colIdx(h.header);
        const raw = idx === -1 ? "" : r[idx];
        row[h.field] = h.kind === "text" ? String(raw ?? "").trim() : parseNum(raw);
      }
      // Owner logins are hard-locked to their own scope regardless of what
      // the uploaded file contains — same rule as every other importer in
      // this codebase and as addItem()'s client-side lock on this page.
      if (isOwnerLogin) row.owner = profile.scope_owner;
      if (!row.owner) row.owner = null;
      if (!row.store_name) row.store_name = null;
      return row;
    });

  if (!mapped.length) return NextResponse.json({ error: "No product rows found under the header" }, { status: 400 });

  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const slice = mapped.slice(i, i + CHUNK);
    const { error } = await admin.from("price_calc_items").insert(slice);
    if (error) return NextResponse.json({ error: error.message, imported }, { status: 500 });
    imported += slice.length;
  }

  return NextResponse.json({ ok: true, imported });
}
