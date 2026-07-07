/* =====================================================================
 * One-time seed: Google Sheet "Market Place Fee" tab -> market_fees table
 * ---------------------------------------------------------------------
 * This is the last time this data comes FROM the sheet — from now on the
 * numbers are edited directly in the app (see migration 0038). Re-running
 * this script is safe: it upserts on (client_id, category, sub_category,
 * jenis_product, platform, jenis_toko), so it never overwrites a value a
 * user has already edited in-app... actually it WILL overwrite, since this
 * upsert has no "only if unedited" guard — only re-run this intentionally,
 * e.g. to pull in newly-added product rows, not to "resync" prices.
 *
 * RUN:
 *   npx tsx scripts/seed-market-fees.ts [<spreadsheet-id>]
 * =====================================================================*/

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SHEET_ID = process.argv[2] || "1c4zhhOxruEb9xyH_TR0C06nFt7aIZFJOQ-_IK3Ivr08";
const SHEET_TAB = "Market Place Fee";
const CHUNK = 500;
// This baseline import is stamped as having been "updated" this month, per
// the user's request — a plain month label (no day), matching the monthly
// (not daily) cadence fees actually change on. No market_fee_log rows are
// written for it: the log tracks incremental single-field edits made after
// this baseline exists, and a fresh bulk import has no meaningful "old
// value" to diff against.
const UPDATE_MONTH = process.argv[3] || "Mei 2026";

function loadEnvLocal() {
  try {
    const txt = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

// This sheet formats fee cells in plain en-US style ("Rp1,250" = 1250,
// "9.00%" = 9, "Rp100,000,000,000" = 1e11) — commas are thousands
// separators here, not decimals. Do NOT reuse src/lib/parse.ts's toNum(),
// which assumes the opposite (Indonesian) convention and would mis-parse
// "1,250" as 1.25.
function parseFeeNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string {
  return String(v ?? "").trim();
}

async function main() {
  loadEnvLocal();
  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA_URL || !SUPA_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).");

  console.log(`Fetching spreadsheet ${SHEET_ID}...`);
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`);
  if (!res.ok) throw new Error(`Failed to download sheet: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[SHEET_TAB];
  if (!ws) throw new Error(`Tab "${SHEET_TAB}" not found. Tabs: ${wb.SheetNames.join(", ")}`);

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
  const header = (matrix[1] || []).map((h) => str(h));
  const idx = (name: string) => header.indexOf(name);
  const iCat = idx("Category"), iSub = idx("Sub Category"), iProd = idx("Jenis Product");
  const iPlat = idx("Platform"), iToko = idx("Jenis Toko");
  const iFee = idx("Platform Fee"), iProses = idx("Biaya Proses Pesanan"), iMall = idx("Biaya Layanan Mall");
  const iKirim = idx("Kategori Kirim");
  const iMinB = idx("Min Gratis Ongkir Uk Biasa"), iMaxB = idx("Max Gratis Ongkir Uk Biasa");
  const iMinK = idx("Min Gratis Ongkir Uk Khusus"), iMaxK = idx("Max Gratis Ongkir Uk Khusus");
  const iMinP = idx("Min Promo Xtra | XBP"), iMaxP = idx("Max Promo Xtra | XBP");
  const iSp3 = idx("Spay Later Xtra 3 mo"), iSp6 = idx("Spay Later Xtra 6 mo");
  if (iCat < 0 || iSub < 0 || iProd < 0) throw new Error("Header row not where expected — sheet layout may have changed.");

  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: clients, error: cErr } = await supa.from("clients").select("id").order("created_at").limit(1);
  if (cErr || !clients?.length) throw new Error("No client row found — " + (cErr?.message || "clients table empty"));
  const clientId = clients[0].id;
  console.log(`Seeding into client_id ${clientId}`);

  const rows = [];
  for (let r = 2; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const category = str(row[iCat]);
    if (!category) continue; // blank/junk trailer rows
    rows.push({
      client_id: clientId,
      category,
      sub_category: str(row[iSub]),
      jenis_product: str(row[iProd]),
      platform: str(row[iPlat]),
      jenis_toko: str(row[iToko]),
      platform_fee: parseFeeNum(row[iFee]),
      biaya_proses_pesanan: parseFeeNum(row[iProses]),
      biaya_layanan_mall: parseFeeNum(row[iMall]),
      kategori_kirim: str(row[iKirim]) || null,
      min_go_biasa: parseFeeNum(row[iMinB]),
      max_go_biasa: parseFeeNum(row[iMaxB]),
      min_go_khusus: parseFeeNum(row[iMinK]),
      max_go_khusus: parseFeeNum(row[iMaxK]),
      min_promo_xtra: parseFeeNum(row[iMinP]),
      max_promo_xtra: parseFeeNum(row[iMaxP]),
      spaylater_3mo: parseFeeNum(row[iSp3]),
      spaylater_6mo: parseFeeNum(row[iSp6]),
      updated_month: UPDATE_MONTH,
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`Parsed ${rows.length} rows. Tagging as "${UPDATE_MONTH}". Upserting in chunks of ${CHUNK}...`);

  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supa.from("market_fees").upsert(slice, {
      onConflict: "client_id,category,sub_category,jenis_product,platform,jenis_toko",
    });
    if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    done += slice.length;
    console.log(`  ${done}/${rows.length}`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
