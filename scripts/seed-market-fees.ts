/* =====================================================================
 * One-time seed: Google Sheet "Market Place Fee" tab -> market_fees table
 * ---------------------------------------------------------------------
 * Superseded by the in-app Upload Market Fee tab for ongoing updates —
 * kept here for re-seeding from the Google Sheet specifically, if needed.
 * Re-running is safe: it upserts on (client_id, category, sub_category,
 * jenis_product, platform, jenis_toko).
 *
 * RUN:
 *   npx tsx scripts/seed-market-fees.ts [<spreadsheet-id>] [<month label>]
 * =====================================================================*/

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { parseMarketFeeMatrix } from "../src/lib/parseMarketFee";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SHEET_ID = process.argv[2] || "1c4zhhOxruEb9xyH_TR0C06nFt7aIZFJOQ-_IK3Ivr08";
const SHEET_TAB = "Market Place Fee";
const CHUNK = 500;
// Baseline import is stamped as having been "updated" this month — a plain
// month label (no day), matching the monthly (not daily) cadence fees
// actually change on. No market_fee_log rows are written for it: the log
// tracks incremental changes made after this baseline exists, and a fresh
// bulk import has no meaningful "old value" to diff against.
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
  const parsed = parseMarketFeeMatrix(matrix);
  if (!parsed.length) throw new Error("No rows parsed — sheet layout may have changed.");

  const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: clients, error: cErr } = await supa.from("clients").select("id").order("created_at").limit(1);
  if (cErr || !clients?.length) throw new Error("No client row found — " + (cErr?.message || "clients table empty"));
  const clientId = clients[0].id;
  console.log(`Seeding into client_id ${clientId}. Parsed ${parsed.length} rows. Tagging as "${UPDATE_MONTH}".`);

  const rows = parsed.map((r) => ({
    client_id: clientId, ...r,
    updated_month: UPDATE_MONTH,
    updated_at: new Date().toISOString(),
  }));

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
