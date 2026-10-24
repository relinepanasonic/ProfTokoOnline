import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { erpAuthorized, NO_STORE } from "@/lib/erpAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// =====================================================================
// GET /api/erp/performance?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Read-only feed for the accounting ERP's Advertiser Dashboard: the store
// performance this app already shows (Dashboard + Ads Performance), one row per
// STORE per WEEK. Same key rules as /api/erp/upload-log (lib/erpAuth.ts).
//
//  * from / to: inclusive calendar days (Asia/Jakarta), range up to 370 days.
//  * A week is returned when its periodStart (its Monday) is inside the range — the ERP
//    groups rows by periodStart. Weeks are real Monday..Sunday dates and may cross a
//    month end; they cannot be split because Product / Ads exports are weekly totals.
//  * All the numbers come from erp_performance() (migration 0138); see its header for
//    which column feeds each field. No negative numbers are ever returned.
//  * Nothing but the listed numbers is exposed: no emails, files, URLs or owners.
//  * Scoped to ONE tenant, ERP_CLIENT_ID (defaults to Prof Toko Online), like upload-log.
// =====================================================================

const CLIENT_ID = process.env.ERP_CLIENT_ID || "92213048-a91b-4202-9b47-8d1c38671082"; // Prof Toko Online
const MAX_RANGE_DAYS = 370;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(s: string): number | null {
  if (!DATE_RE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  // reject 2026-02-31 style dates that JS silently rolls over
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return t;
}

// Defence in depth: the SQL already clamps at 0, but this feed must never carry a negative number.
function nonNegative<T>(v: T): T {
  if (typeof v === "number") return (Number.isFinite(v) && v > 0 ? v : 0) as T;
  if (Array.isArray(v)) return v.map(nonNegative) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nonNegative(x)])) as T;
  return v;
}

export async function GET(req: NextRequest) {
  if (!erpAuthorized(req)) return new NextResponse(null, { status: 401, headers: NO_STORE });

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  const fromMs = parseDay(from), toMs = parseDay(to);
  if (fromMs == null || toMs == null) {
    return NextResponse.json({ error: "from and to are required, as YYYY-MM-DD" }, { status: 400, headers: NO_STORE });
  }
  if (toMs < fromMs) return NextResponse.json({ error: "invalid date range" }, { status: 400, headers: NO_STORE });
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1; // inclusive
  if (days > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `range too long — max ${MAX_RANGE_DAYS} days` }, { status: 400, headers: NO_STORE });
  }

  const { data, error } = await createAdminClient().rpc("erp_performance", {
    p_client_id: CLIENT_ID, p_from: from, p_to: to,
  });
  if (error) {
    console.error("erp_performance failed:", error);
    return NextResponse.json({ error: "query failed" }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", rows: nonNegative((data as unknown[]) || []) },
    { status: 200, headers: NO_STORE },
  );
}
