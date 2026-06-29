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

const HEADER_HINTS: Record<DataSource, string[]> = {
  spos: ["Produk", "Kode Produk"],
  ads: ["Nama Iklan"],
  perf: ["Total Pengunjung", "Kunjungan"],
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
    .select("client_id, role")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  if (!["superadmin", "client_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  // 2. Read the multipart form: a file, its source, target client, manual fields.
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const source = String(form.get("source") || "") as DataSource;
  const manual: ManualFields = JSON.parse(String(form.get("manual") || "{}"));

  // superadmin & client_admin are both global → the target client comes from
  // the form (a dropdown sourced from Core List, never free-typed).
  const clientId = String(form.get("client_id") || "");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!SOURCES.includes(source))
    return NextResponse.json({ error: "BAD_SOURCE" }, { status: 400 });
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  // 3. Parse the file (xlsx or csv) with SheetJS.
  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });

  if (!matrix.length)
    return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });

  const headerIdx = findHeaderRow(matrix, HEADER_HINTS[source]);
  const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  let dataRows = matrix.slice(headerIdx + 1);

  // Shopee "Tinjauan Penjualan" (Performa) exports stack TWO tables in one
  // sheet: a 1-row weekly summary, then a blank row, then a per-day breakdown
  // with a *different* column layout. If we read past the blank row we'd parse
  // the daily rows with the summary's headers — misreading columns AND
  // double-counting the same sales. So for perf, keep only the first table.
  if (source === "perf") {
    const blankIdx = dataRows.findIndex(
      (r) => !Array.isArray(r) || !r.some((c) => c !== "" && c != null)
    );
    if (blankIdx >= 0) dataRows = dataRows.slice(0, blankIdx);
  }

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
        if (!h) return;
        const val = (r as unknown[])[i] ?? null;
        raw[h] = val;
        raw[bqCol(h)] = val; // also store sanitized key so mapRow's get() hits
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

  return NextResponse.json({ ok: true, upload_id: upload.id, rows: inserted });
}
