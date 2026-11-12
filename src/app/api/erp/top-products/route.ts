import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { erpAuthorized, NO_STORE } from "@/lib/erpAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// =====================================================================
// GET /api/erp/top-products?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=10
//
// Read-only feed for the accounting ERP's weekly client report (page 2): the best-selling
// products of each store. Same key rules as /api/erp/performance (lib/erpAuth.ts).
//
//  * from / to: inclusive calendar days (Asia/Jakarta), range up to 62 days.
//  * A week is included when its Monday (periodStart) is inside the range — the same rule as
//    /api/erp/performance, so Mon..Sun 2026-11-09..2026-11-15 is exactly that one week.
//    Over several weeks each product is summed, then ranked.
//  * limit = products per store, default 10, max 20.
//  * Product sales = the same number as the monthly PDF's "Top 10 Produk Terlaris" and as
//    `sales` in /api/erp/performance (SPOS parent rows); see erp_top_products() (migration 0140).
//  * `store` is identical to /api/erp/performance's `store`; `workspace` is always "" here.
//  * Scoped to ONE tenant, ERP_CLIENT_ID (defaults to Prof Toko Online), like /performance.
// =====================================================================

const CLIENT_ID = process.env.ERP_CLIENT_ID || "92213048-a91b-4202-9b47-8d1c38671082"; // Prof Toko Online
const MAX_RANGE_DAYS = 62;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(s: string): number | null {
  if (!DATE_RE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  // reject 2026-02-31 style dates that JS silently rolls over
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return t;
}

type Store = { store: string; workspace: string; products: { name: string; sales: number }[] };

// Defence in depth: the SQL already keeps only positive sales, but this feed must never carry a negative number.
function clean(stores: Store[]): Store[] {
  return stores
    .map((s) => ({
      store: s.store,
      workspace: "",
      products: (s.products || [])
        .map((p) => ({ name: String(p.name ?? "").trim(), sales: Number(p.sales) }))
        .filter((p) => p.name && Number.isFinite(p.sales) && p.sales > 0),
    }))
    .filter((s) => s.products.length > 0);
}

export async function GET(req: NextRequest) {
  if (!erpAuthorized(req)) return new NextResponse(null, { status: 401, headers: NO_STORE });

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const fromMs = parseDay(from), toMs = parseDay(to);
  if (fromMs == null || toMs == null) {
    return NextResponse.json({ error: "from and to are required, as YYYY-MM-DD" }, { status: 400, headers: NO_STORE });
  }
  if (toMs < fromMs) return NextResponse.json({ error: "invalid date range" }, { status: 400, headers: NO_STORE });
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1; // inclusive
  if (days > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `range too long — max ${MAX_RANGE_DAYS} days` }, { status: 400, headers: NO_STORE });
  }

  let limit = DEFAULT_LIMIT;
  const rawLimit = sp.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    if (!/^\d+$/.test(rawLimit)) {
      return NextResponse.json({ error: `limit must be a whole number from 1 to ${MAX_LIMIT}` }, { status: 400, headers: NO_STORE });
    }
    limit = Math.min(Math.max(Number(rawLimit), 1), MAX_LIMIT);
  }

  const { data, error } = await createAdminClient().rpc("erp_top_products", {
    p_client_id: CLIENT_ID, p_from: from, p_to: to, p_limit: limit,
  });
  if (error) {
    console.error("erp_top_products failed:", error);
    return NextResponse.json({ error: "query failed" }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", from, to, stores: clean((data as Store[]) || []) },
    { status: 200, headers: NO_STORE },
  );
}
