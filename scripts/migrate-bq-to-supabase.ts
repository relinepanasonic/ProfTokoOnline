/* =====================================================================
 * BigQuery  ->  Supabase  migration  (one-time, resumable, idempotent)
 * ---------------------------------------------------------------------
 * Copies every Reline dashboard table out of BigQuery
 * (`reline-dashboard.RelineDashboard.{year}Q{n}{Region}{SPOS|Ads|Performa}`)
 * into the deployed ProfTokoOnline schema:
 *   - one `uploads`  row per BQ table  (audit + delete-by-upload)
 *   - N  `sales_rows` rows, mapped with the SAME `mapRow()` the live
 *     upload route uses, so migrated data is byte-for-byte consistent
 *     with anything uploaded through the app afterwards.
 *
 * It NEVER touches BigQuery or the GAS app — pure read from BQ, write to
 * Supabase — so the old stack keeps running untouched during parallel run.
 *
 * RESUMABLE: each `uploads.meta.bq_table` records which BQ table it came
 * from. Re-running skips tables already migrated, so a crash / timeout is
 * safe to just re-run.
 *
 * ---------------------------------------------------------------------
 * RUN:
 *   1. Authenticate to BigQuery (pick ONE):
 *        a) gcloud auth application-default login   (easiest)
 *        b) set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
 *   2. Make sure .env.local has NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   3. From the project root:
 *        npm run migrate:bq -- --dry-run          # inspect, write nothing
 *        npm run migrate:bq                        # do it
 *        npm run migrate:bq -- --limit 3           # only first 3 tables
 *        npm run migrate:bq -- --seed-master       # also seed Core List
 *
 * NOTE ON SALES SEMANTICS (read before trusting parallel-run totals):
 *   `mapRow()` maps SPOS sales_idr from "Total Penjualan (Pesanan Dibuat)"
 *   (orders *created*). The OLD GAS dashboard summed "Pesanan Siap Dikirim"
 *   (ready-to-ship). Numbers will therefore differ between the two apps.
 *   This is the NEW app's existing choice (in src/lib/parse.ts) — change it
 *   there if you want them to match, and re-run this migration.
 * ===================================================================== */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BigQuery } from "@google-cloud/bigquery";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mapRow, type DataSource, type ManualFields } from "../src/lib/parse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/* ---------------- config ---------------- */
const BQ_PROJECT = process.env.BQ_PROJECT || "reline-dashboard";
const BQ_DATASET = process.env.BQ_DATASET || "RelineDashboard";
const BQ_LOCATION = process.env.BQ_LOCATION || "asia-southeast2";

// The client these rows belong to. The migration creates it if absent.
const CLIENT_SLUG = process.env.CLIENT_SLUG || "panasonic";
const CLIENT_NAME = process.env.CLIENT_NAME || "Panasonic";

const CHUNK = 1000; // sales_rows insert batch size

// CLI flags
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const SEED_MASTER = args.includes("--seed-master");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : Infinity;
})();

/* ---- known dealer-name typos (ported from Code.gs DEALER_NAME_MAP_) ---- */
const DEALER_RENAMES: Record<string, string> = {
  "Sumber Multi - CInere": "Sumber Multi - Cinere",
};
const normDealer = (n: string) => DEALER_RENAMES[n] ?? n;

/* BQ table type suffix -> sales_rows data_source enum */
const SOURCE_OF: Record<string, DataSource> = {
  SPOS: "spos",
  Ads: "ads",
  Performa: "perf",
};

/* ---------------- env loading (.env.local, no dotenv dep) ---------------- */
function loadEnvLocal() {
  try {
    const txt = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* .env.local optional if vars already in environment */
  }
}

/* ---------------- table-name parsing (ported from Code.gs) ---------------- */
interface ParsedTable {
  name: string;
  year: number;
  quarter: string; // "Q1".."Q4"
  region: string;
  type: string; // "SPOS" | "Ads" | "Performa"
}
function parseTableName(name: string): ParsedTable | null {
  const m = name.match(/^(\d{4})(Q\d+)(.+?)(SPOS|Ads|Performa)$/);
  if (!m) return null;
  return { name, year: parseInt(m[1], 10), quarter: m[2], region: m[3], type: m[4] };
}

/* Parse a messy date-ish string -> "YYYY-MM-DD" or undefined (sales_rows.tanggal is DATE). */
function cleanDate(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/* ---------------- main ---------------- */
async function main() {
  loadEnvLocal();

  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA_URL || !SUPA_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)."
    );
  }

  const bq = new BigQuery({ projectId: BQ_PROJECT, location: BQ_LOCATION });
  const supa: SupabaseClient = createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`\n== BQ -> Supabase migration ${DRY ? "(DRY RUN)" : ""} ==`);
  console.log(`BigQuery: ${BQ_PROJECT}.${BQ_DATASET} (${BQ_LOCATION})`);
  console.log(`Supabase: ${SUPA_URL}`);

  /* 1. Ensure the client row exists, get its id. */
  const clientId = await ensureClient(supa);
  console.log(`Client: ${CLIENT_NAME} (${CLIENT_SLUG}) -> ${clientId}`);

  /* 2. Discover candidate tables in BQ (same rule as getAllTables_):
        name matches ^YYYYQn..., has a `Bulan` column, and the _src external
        pointers are excluded automatically because parseTableName anchors the
        type suffix at the end (..._src never matches). */
  const discoverSql = `
    SELECT t.table_name
    FROM \`${BQ_PROJECT}.${BQ_DATASET}.INFORMATION_SCHEMA.TABLES\` t
    WHERE REGEXP_CONTAINS(t.table_name, r'^[0-9]{4}Q[0-9]+')
      AND EXISTS (
        SELECT 1 FROM \`${BQ_PROJECT}.${BQ_DATASET}.INFORMATION_SCHEMA.COLUMNS\` c
        WHERE c.table_name = t.table_name AND c.column_name = 'Bulan'
      )
    ORDER BY t.table_name
  `;
  const [discRows] = await bq.query({ query: discoverSql, location: BQ_LOCATION });
  const tables = discRows
    .map((r: Record<string, unknown>) => parseTableName(String(r.table_name)))
    .filter((t): t is ParsedTable => t !== null);
  console.log(`Discovered ${tables.length} migratable BQ tables.`);

  /* 3. Build the resume set: BQ tables already migrated (uploads.meta.bq_table). */
  const done = new Set<string>();
  {
    const { data, error } = await supa
      .from("uploads")
      .select("meta")
      .eq("client_id", clientId);
    if (error) throw new Error("Reading existing uploads: " + error.message);
    for (const u of data ?? []) {
      const bt = (u.meta as Record<string, unknown> | null)?.bq_table;
      if (typeof bt === "string") done.add(bt);
    }
  }
  if (done.size) console.log(`Resuming — ${done.size} table(s) already migrated, will skip.`);

  /* 4. Migrate each table. */
  const masterCities = new Map<string, string>(); // city -> pic
  const masterDealers = new Map<string, string>(); // dealer -> city
  let migrated = 0,
    skipped = 0,
    failed = 0,
    totalRows = 0;

  for (const t of tables) {
    if (migrated >= LIMIT) break;
    if (done.has(t.name)) {
      skipped++;
      continue;
    }

    const source = SOURCE_OF[t.type];
    try {
      const [bqRows] = await bq.query({
        query: `SELECT * FROM \`${BQ_PROJECT}.${BQ_DATASET}.${t.name}\``,
        location: BQ_LOCATION,
      });

      const mapped = (bqRows as Record<string, unknown>[]).map((row) => {
        const city = String(row.City ?? "").trim();
        const dealer = normDealer(String(row.Dealer ?? "").trim());
        if (city) masterCities.set(city, String(row.PIC_Panasonic ?? "").trim());
        if (dealer) masterDealers.set(dealer, city);

        const manual: ManualFields = {
          year: t.year,
          bulan: String(row.Bulan ?? "").trim() || undefined,
          week: String(row.Week ?? "").trim() || undefined,
          city: city || undefined,
          pic_client: String(row.PIC_Panasonic ?? "").trim() || undefined,
          store_name: dealer || undefined,
          tanggal: cleanDate(row.Tanggal ?? row.Tanggal_Mulai),
        };
        // Reuse the app's mapper: BigQuery already sanitized headers the same
        // way bqCol() does, so mapRow's get() resolves every metric column.
        return { ...mapRow(source, row, manual), client_id: clientId, upload_id: "" };
      });

      if (DRY) {
        console.log(
          `  [dry] ${t.name}: ${mapped.length} rows -> ${source}` +
            (mapped[0]
              ? `  e.g. {city:${mapped[0].city}, store:${mapped[0].store_name}, month:${mapped[0].month}, sales:${mapped[0].sales_idr}, parent:${mapped[0].is_parent}}`
              : "")
        );
        migrated++;
        totalRows += mapped.length;
        continue;
      }

      /* 4a. uploads row (FK target for sales_rows). meta carries provenance. */
      const { data: up, error: upErr } = await supa
        .from("uploads")
        .insert({
          client_id: clientId,
          source,
          filename: `migrated:${t.name}`,
          row_count: 0,
          meta: {
            bq_table: t.name,
            year: t.year,
            quarter: t.quarter,
            region: t.region,
            migrated_at: new Date().toISOString(),
          },
        })
        .select("id")
        .single();
      if (upErr || !up) throw new Error("uploads insert: " + (upErr?.message || "no id"));

      /* 4b. chunked sales_rows insert; roll back this upload on any failure. */
      let inserted = 0;
      for (let i = 0; i < mapped.length; i += CHUNK) {
        const slice = mapped.slice(i, i + CHUNK).map((r) => ({ ...r, upload_id: up.id }));
        const { error } = await supa.from("sales_rows").insert(slice);
        if (error) {
          await supa.from("uploads").delete().eq("id", up.id); // no partial load
          throw new Error("sales_rows insert: " + error.message);
        }
        inserted += slice.length;
      }
      await supa.from("uploads").update({ row_count: inserted }).eq("id", up.id);

      migrated++;
      totalRows += inserted;
      console.log(`  OK  ${t.name}: ${inserted} rows (${source})`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${t.name}: ${(e as Error).message}`);
    }
  }

  /* 5. Optional: seed Core List (master_data) from the dimensions we saw. */
  if (SEED_MASTER && !DRY) {
    await seedMaster(supa, clientId, masterCities, masterDealers);
  } else if (SEED_MASTER && DRY) {
    console.log(
      `  [dry] would seed master_data: ${masterCities.size} cities, ${masterDealers.size} dealers`
    );
  }

  console.log(
    `\nDone. migrated=${migrated} skipped=${skipped} failed=${failed} rows=${totalRows}` +
      (DRY ? "  (DRY RUN — nothing written)" : "")
  );
  if (failed) process.exitCode = 1;
}

/* Look up the client by slug; create it if missing. Returns its id. */
async function ensureClient(supa: SupabaseClient): Promise<string> {
  const { data: existing, error } = await supa
    .from("clients")
    .select("id")
    .eq("slug", CLIENT_SLUG)
    .maybeSingle();
  if (error) throw new Error("clients lookup: " + error.message);
  if (existing) return existing.id;

  if (DRY) return "(dry-run-client-id)";
  const { data, error: insErr } = await supa
    .from("clients")
    .insert({
      name: CLIENT_NAME,
      slug: CLIENT_SLUG,
      pic_label: "PIC Panasonic",
      store_label: "Dealer",
    })
    .select("id")
    .single();
  if (insErr || !data) throw new Error("clients insert: " + (insErr?.message || "no id"));
  return data.id;
}

/* Seed master_data (cities w/ PIC, dealers w/ city) from migrated dimensions.
   Mirrors the GAS Core List model; idempotent via upsert on (client_id,kind,value). */
async function seedMaster(
  supa: SupabaseClient,
  clientId: string,
  cities: Map<string, string>,
  dealers: Map<string, string>
) {
  const rows: Record<string, unknown>[] = [];
  for (const [value, pic] of cities) {
    if (value && value !== "-") rows.push({ client_id: clientId, kind: "city", value, pic: pic || null });
  }
  for (const [value, city] of dealers) {
    if (value && value !== "-")
      rows.push({ client_id: clientId, kind: "dealer", value, city: city || null, pic: cities.get(city) || null });
  }
  if (!rows.length) return;
  const { error } = await supa
    .from("master_data")
    .upsert(rows, { onConflict: "client_id,kind,value" });
  if (error) throw new Error("master_data seed: " + error.message);
  console.log(`  Seeded master_data: ${cities.size} cities, ${dealers.size} dealers.`);
}

main().catch((e) => {
  console.error("\nMIGRATION ABORTED:", e.message);
  process.exit(1);
});
