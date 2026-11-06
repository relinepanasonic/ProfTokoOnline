import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportAuthorized, NO_STORE } from "@/lib/erpAuth";
import { buildOwnerReport, jakartaToday, lastWeekRange, type PerfRow } from "@/lib/weeklyReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// =====================================================================
// GET /api/reports/weekly            (called by Make.com every Monday morning)
//   ?weekStart=YYYY-MM-DD   optional, a Monday — defaults to the last COMPLETED Mon..Sun week (Asia/Jakarta)
//   ?owner=<name>           optional, only this Owner (for a test send)
//
// One report per Owner that has a WhatsApp group switched on (table report_groups), built from
// erp_performance() so the numbers equal what the dashboards show. Each report only contains
// that Owner's own stores. `message` is ready to send as-is; Make.com sends it to `groupId`.
//
// Same key rules as the ERP feeds (lib/erpAuth.ts) with its own key REPORT_API_KEY: Bearer header
// only, constant-time, unset -> 401, no-store, read-only, no CORS.
// =====================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function validMonday(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s && new Date(t).getUTCDay() === 1;
}

export async function GET(req: NextRequest) {
  if (!reportAuthorized(req)) return new NextResponse(null, { status: 401, headers: NO_STORE });

  const weekStart = req.nextUrl.searchParams.get("weekStart");
  const onlyOwner = (req.nextUrl.searchParams.get("owner") || "").trim();

  let range = lastWeekRange(jakartaToday());
  if (weekStart) {
    if (!validMonday(weekStart)) {
      return NextResponse.json({ error: "weekStart must be a Monday, as YYYY-MM-DD" }, { status: 400, headers: NO_STORE });
    }
    const t = Date.parse(`${weekStart}T00:00:00Z`);
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    range = { start: weekStart, end: iso(t + 6 * DAY), prevStart: iso(t - 7 * DAY) };
  }

  const db = createAdminClient();
  let q = db.from("report_groups").select("client_id,owner,group_id").eq("enabled", true).neq("group_id", "");
  if (onlyOwner) q = q.eq("owner", onlyOwner);
  const { data: groups, error: gErr } = await q;
  if (gErr) {
    console.error("report_groups failed:", gErr);
    return NextResponse.json({ error: "query failed" }, { status: 500, headers: NO_STORE });
  }

  const byClient = new Map<string, { owner: string; group_id: string }[]>();
  for (const g of (groups as { client_id: string; owner: string; group_id: string }[]) || []) {
    byClient.set(g.client_id, [...(byClient.get(g.client_id) || []), g]);
  }

  const reports: unknown[] = [];
  for (const [clientId, list] of byClient) {
    const [perf, links] = await Promise.all([
      db.rpc("erp_performance", { p_client_id: clientId, p_from: range.prevStart, p_to: range.end }),
      db.from("store_links").select("owner,store_name").eq("client_id", clientId).not("store_name", "is", null),
    ]);
    if (perf.error || links.error) {
      console.error("weekly report failed:", perf.error || links.error);
      return NextResponse.json({ error: "query failed" }, { status: 500, headers: NO_STORE });
    }
    const rows = ((perf.data as PerfRow[]) || []);
    const last = rows.filter((r) => r.periodStart >= range.start && r.periodStart <= range.end);
    const prev = rows.filter((r) => r.periodStart >= range.prevStart && r.periodStart < range.start);
    for (const g of list) {
      const stores = ((links.data as { owner: string | null; store_name: string }[]) || [])
        .filter((l) => l.owner === g.owner).map((l) => l.store_name);
      const r = buildOwnerReport(g.owner, range.start, range.end, stores, last, prev);
      reports.push({ owner: r.owner, groupId: g.group_id, periodStart: r.start, periodEnd: r.end, hasData: r.hasData, message: r.message, totals: r.totals, stores: r.stores });
    }
  }

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", periodStart: range.start, periodEnd: range.end, reports },
    { status: 200, headers: NO_STORE },
  );
}
