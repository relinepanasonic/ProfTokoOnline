import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { ReportDocument, lastN } from "@/lib/reportPdf";
import { priorMonth, type Summary, type AdsSummary, type Lang } from "@/lib/reportInsights";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/reports/pdf — the client-facing performance deck, rendered from
// exactly the filter selection the caller has on screen.
//
// No extra role gate beyond "signed in": every figure comes from
// dashboard_summary / ads_dashboard_summary, which already scope their
// result to the caller (and an Owner is re-locked to their own scope_owner
// below regardless of what the request body says). The PDF therefore holds
// exactly what that user can already see on the dashboard — no new exposure.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const f = (await req.json()) as {
    year?: string; month?: string; owner?: string; brand?: string; store?: string; lang?: Lang;
  };
  const lang: Lang = f.lang === "en" ? "en" : "id";

  const { data: p } = await supabase
    .from("profiles").select("client_id,role,scope_owner,display_name").eq("id", user.id).single();
  const prof = p as { client_id: string | null; role: string; scope_owner: string | null; display_name: string | null } | null;
  const isOwner = prof?.role === "branch_manager";

  // An Owner is hard-scoped to their own scope_owner regardless of the
  // request body — the same rule the Dashboard and /report enforce, so a
  // hand-crafted POST can't widen the deck beyond what that login may see.
  const owner = isOwner ? (prof?.scope_owner || "") : (f.owner || "");
  const clientId = isOwner
    ? (prof?.client_id || "")
    : ((await supabase.from("clients").select("id").order("created_at").limit(1)).data as { id: string }[] | null)?.[0]?.id || "";
  if (!clientId) return NextResponse.json({ error: "NO_CLIENT" }, { status: 400 });

  const { data: c } = await supabase.from("clients").select("name,store_label").eq("id", clientId).single();
  const client = c as { name: string | null; store_label: string | null } | null;

  const common = {
    p_client_id: clientId,
    p_year: f.year ? Number(f.year) : null,
    p_city: null,
    p_owner: owner || null,
    p_brand: f.brand || null,
    p_store: f.store || null,
  };
  const prevM = priorMonth(f.month || null);

  const [curR, prevR, baseR, adsR, trendR] = await Promise.all([
    supabase.rpc("dashboard_summary", { ...common, p_month: f.month || null }),
    prevM ? supabase.rpc("dashboard_summary", { ...common, p_month: prevM }) : Promise.resolve({ data: null, error: null }),
    supabase.rpc("dashboard_summary", { ...common, p_month: "Baseline" }),
    supabase.rpc("ads_dashboard_summary", {
      p_year: f.year ? Number(f.year) : null,
      p_month: f.month || null,
      p_owner: owner || null,
      p_brand: f.brand || null,
      p_store: f.store || null,
    }),
    // Trend charts need history: a month-filtered summary only ever holds
    // that one month's bucket, so this call drops the month.
    f.month
      ? supabase.rpc("dashboard_summary", { ...common, p_month: null })
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (curR.error || !curR.data) {
    return NextResponse.json(
      { error: curR.error?.message || (lang === "id" ? "Tidak ada data untuk filter ini" : "No data for this filter") },
      { status: 400 }
    );
  }

  const current = curR.data as Summary;
  const trendSrc = ((trendR.data as Summary) || current);
  const trend = lastN(trendSrc.monthly_sales || [], 6);
  const costRoasTrend = lastN(trendSrc.cost_roas || [], 6);

  // Partial-month guard: a deck built from 2 of 4 uploaded weeks would
  // understate the client's month and destroy trust in every number on it.
  let partialWeeks: number | null = null;
  if (f.month && f.month !== "Baseline") {
    let q = supabase.from("dashboard_month_completeness")
      .select("week_count").eq("client_id", clientId).eq("month", f.month);
    if (f.store) q = q.eq("store_name", f.store);
    const { data: comp } = await q;
    const rows = (comp as { week_count: number }[]) || [];
    partialWeeks = rows.length ? Math.min(...rows.map((r) => r.week_count)) : null;
  }

  const periodLabel = f.month
    ? `${f.month}${f.year ? " " + f.year : ""}`
    : f.year || (lang === "id" ? "Semua Periode" : "All Periods");

  const buffer = await renderToBuffer(
    ReportDocument({
      clientName: client?.name || "",
      ownerName: owner || prof?.display_name || "",
      storeLabel: client?.store_label || "Store",
      storeName: f.store || "",
      periodLabel,
      generatedAt: new Date().toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", {
        day: "2-digit", month: "long", year: "numeric",
      }),
      current,
      previous: (prevR.data as Summary) || null,
      baseline: (baseR.data as Summary) || null,
      ads: (adsR.data as AdsSummary) || null,
      trend,
      costRoasTrend,
      partialWeeks,
      lang,
    })
  );

  const safe = (v: string) => v.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const yearPart = f.year ? safe(f.year) : "all";
  const monthPart = f.month ? safe(f.month) : "all";
  const filename = `${yearPart}.${monthPart}.${safe(client?.name || "Client")}.ProfTokoOnlineReport.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
