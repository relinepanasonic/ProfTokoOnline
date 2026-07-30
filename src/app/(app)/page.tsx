"use client";

import { useEffect, useState, useCallback, useId } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import UploadGate from "@/components/UploadGate";
import { useLang } from "@/lib/i18n";
import { useTableSort } from "@/hooks/useTableSort";
import SortableHeader from "@/components/SortableHeader";
import { sortByBucket } from "@/lib/timeBuckets";

export const dynamic = "force-dynamic";

// recharts (~430KB) and the chart components that use it live in a separate
// module, loaded client-side only, on demand — not during SSR and not in
// this page's own bundle. StoreDrillDown is included too: it's a modal only
// rendered on click, so there's no reason to ship its chart code up front.
const ChartDefs         = dynamicImport(() => import("./DashboardCharts").then((m) => m.ChartDefs), { ssr: false });
const MonthlySalesChart = dynamicImport(() => import("./DashboardCharts").then((m) => m.MonthlySalesChart), { ssr: false });
const HBarsChart        = dynamicImport(() => import("./DashboardCharts").then((m) => m.HBarsChart), { ssr: false });
const CostRoasChart     = dynamicImport(() => import("./DashboardCharts").then((m) => m.CostRoasChart), { ssr: false });
const AvgStoreTrendChart = dynamicImport(() => import("./DashboardCharts").then((m) => m.AvgStoreTrendChart), { ssr: false });
const TrafficChart      = dynamicImport(() => import("./DashboardCharts").then((m) => m.TrafficChart), { ssr: false });
const StoreDrillDown    = dynamicImport(() => import("./DashboardCharts").then((m) => m.StoreDrillDown), { ssr: false });

// Shared with globals.css's mobile breakpoint (max-width:760px) so chart
// internals (label truncation, axis widths, layout direction) match the
// same point the rest of the UI switches to its mobile layout.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width:760px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

type Summary = {
  kpis: { sales: number; gmv: number; traffic: number; in_cart: number; orders: number; transactions: number; orders_created: number; product_views: number; visitor_cart_adds: number; ad_cost: number; roas: number | null };
  monthly_sales: { month: string; sales: number }[];
  store_monthly: { month: string; gmv: number }[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  cost_roas: { month: string; cost: number; roas: number | null }[];
  // Dynamic-granularity series for the Monthly/Weekly Performance chart:
  // bucket = month name (All Months) or week label (a month selected).
  perf_trend: { bucket: string; sales: number; traffic: number; in_cart: number }[];
  traffic_trend: { month: string; traffic: number; in_cart: number; transactions: number; visitor_cart_adds: number }[];
  avg_store_trend: { store_name: string; avg_sales: number }[];
  top_campaigns: { name: string; store_name: string | null; views: number; clicks: number; add_to_cart: number; orders: number; sales: number; ad_cost: number }[];
  dealers: { store_name: string; city: string; sales: number; traffic: number; in_cart: number; orders: number; ad_cost: number; roas: number | null; trend?: { month: string; sales: number; ad_cost: number | null }[] }[];
};
type DealerRow = Summary["dealers"][number] & { cart_rate: number };
type Filters = { years: number[]; months: string[]; stores: string[] };
type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const byMonth = <T extends { month: string }>(a: T[]) =>
  [...(a || [])].sort((x, y) => MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month));

const idr  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num  = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

const GOLD   = "#c9a227";
const GOLD_L = "#f0d870";
const BLUE   = "#3b82f6";
const BLUE_L = "#60a5fa";

/* ─── Radial gauge (ROAS) — glowing ring, replaces the old linear bar ─── */
function RadialGauge({ pct, size = 42, stroke = 5, color = GOLD }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const offset = c * (1 - clamped / 100);
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dashoffset 1s cubic-bezier(.34,1.4,.64,1)" }} />
    </svg>
  );
}

export default function DashboardPage() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [storeLabel, setStoreLabel] = useState("Store");
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  // An Owner (branch_manager) is hard-scoped to their own scope_owner: the
  // Owner filter renders read-only and p_owner is always forced server-side.
  const [role, setRole] = useState("");
  const [scopeOwner, setScopeOwner] = useState("");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], stores: [] });
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "", owner: "", brand: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [filtersErr, setFiltersErr] = useState("");

  useEffect(() => {
    (async () => {
      // Resolve the user FIRST — the meta cache is namespaced per user id so
      // a shared browser never paints the previous account's owner list or
      // KPIs before the network fetch lands.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      try {
        const raw = localStorage.getItem(`ptoko_dash_meta_v2:${user.id}`);
        if (raw) {
          const m = JSON.parse(raw) as { filters?: Filters; links?: StoreLink[]; storeLabel?: string };
          if (m.filters) setFilters(m.filters);
          if (m.links) setLinks(m.links);
          if (m.storeLabel) setStoreLabel(m.storeLabel);
        }
      } catch { /* ignore */ }

      let label = "Store";
      const { data: p } = await supabase.from("profiles").select("client_id,role,scope_owner").eq("id", user.id).single();
      const prof = p as { client_id: string | null; role: string; scope_owner: string | null } | null;
      const isOwner = prof?.role === "branch_manager";
      const owner = isOwner ? (prof?.scope_owner || "") : "";
      setRole(prof?.role || "");
      setScopeOwner(owner);
      // Owners are locked to their own tenant; staff (superadmin/client_admin/
      // advertiser) fall back to the first-created client — same convention
      // used on StoreDashboard/AdsOverview/Upload.
      const cid = isOwner
        ? (prof?.client_id || "")
        : ((await supabase.from("clients").select("id").order("created_at").limit(1)).data as { id: string }[] | null)?.[0]?.id || "";
      setClientId(cid);
      if (prof?.client_id) {
        const { data: c } = await supabase.from("clients").select("store_label").eq("id", prof.client_id).single();
        if (c?.store_label) { label = c.store_label; setStoreLabel(label); }
      }
      const [{ data: f, error: fErr }, { data: sl, error: slErr }] = await Promise.all([
        supabase.rpc("dashboard_filters", { p_client_id: cid || null, p_owner: owner || null }),
        supabase.from("store_links").select("owner,brand,store_name").eq("client_id", cid).order("owner"),
      ]);
      const rpcErr = fErr || slErr;
      setFiltersErr(rpcErr ? `${rpcErr.message} (code: ${rpcErr.code || "?"})` : "");
      if (f) setFilters(f as Filters);
      setLinks((sl as StoreLink[]) || []);
      try {
        localStorage.setItem(`ptoko_dash_meta_v2:${user.id}`, JSON.stringify({ filters: f, links: sl, storeLabel: label }));
      } catch { /* quota */ }
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    // dashboard_summary now requires p_client_id (migration 0094) — wait for
    // the meta effect to resolve it rather than firing an unresolvable call.
    if (!clientId || !userId) return;
    // An Owner is hard-scoped to their own scope_owner regardless of what the
    // (read-only) Owner filter shows — this also narrows the query up front so
    // it never scans the whole tenant, which is what caused the 57014 timeout.
    const effectiveOwner = role === "branch_manager" ? (scopeOwner || null) : (sel.owner || null);
    // Stale-while-revalidate: paint the last-seen result for this exact filter
    // selection instantly from localStorage (huge mobile win — no blank wait
    // for the ~5s query), then refresh in the background. Namespaced per user
    // so a shared browser never shows another account's cached KPIs.
    const cacheKey = `ptoko_dash_v2:${userId}:${JSON.stringify(sel)}`;
    let hadCache = false;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) { setD(JSON.parse(raw) as Summary); hadCache = true; }
    } catch { /* ignore */ }

    setLoading(true);
    const { data, error } = await supabase.rpc("dashboard_summary", {
      p_client_id: clientId,
      p_year:  sel.year  ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city:  sel.city  || null,
      p_owner: effectiveOwner,
      p_brand: sel.brand || null,
      p_store: sel.store || null,
    });
    // keep the stale snapshot on screen if the fresh fetch failed
    if (error && hadCache) setLoadErr("");
    else setLoadErr(error ? `${error.message} (code: ${error.code || "?"})` : "");
    if (data) {
      setD(data as Summary);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
    }
    setLoading(false);
  }, [supabase, sel, clientId, userId, role, scopeOwner]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const owners = Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort();
  const brandsForOwner = sel.owner
    ? Array.from(new Set(links.filter((l) => l.owner === sel.owner).map((l) => l.brand).filter(Boolean) as string[])).sort()
    : Array.from(new Set(links.map((l) => l.brand).filter(Boolean) as string[])).sort();
  const filteredStores = (() => {
    let base = filters.stores;
    if (sel.brand) base = base.filter((s) => links.some((l) => l.store_name === s && l.brand === sel.brand && (!sel.owner || l.owner === sel.owner)));
    else if (sel.owner) base = base.filter((s) => links.some((l) => l.store_name === s && l.owner === sel.owner));
    return base;
  })();

  function pickOwner(owner: string) { setSel((s) => ({ ...s, owner, brand: "", store: "" })); }
  function pickBrand(brand: string) { setSel((s) => ({ ...s, brand, store: "" })); }
  function pickStore(store: string) {
    const link = links.find((l) => l.store_name === store);
    setSel((s) => ({ ...s, store, owner: link?.owner || s.owner, brand: link?.brand || s.brand }));
  }

  const k = d?.kpis;
  const roasPct  = k?.roas ? Math.min((k.roas / 5) * 100, 100) : 0;
  const salesSeries   = byMonth(d?.monthly_sales || []).map((x) => x.sales);
  const transactionSeries = byMonth(d?.traffic_trend || []).map((x) => x.transactions);
  const trafficSeries  = byMonth(d?.traffic_trend || []).map((x) => x.traffic);
  const cartAddsSeries = byMonth(d?.traffic_trend || []).map((x) => x.visitor_cart_adds);
  const adCostSeries   = byMonth(d?.cost_roas || []).map((x) => x.cost);
  const [drillStore, setDrillStore] = useState<Summary["dealers"][number] | null>(null);

  // cart_rate is derived (not a stored field) so it can be sorted too.
  const dealerRows: DealerRow[] = (d?.dealers || []).map((r) => ({ ...r, cart_rate: r.traffic ? (r.in_cart / r.traffic) * 100 : 0 }));
  const dealersSort = useTableSort<DealerRow>(dealerRows, "sales");

  return (
    <UploadGate>
    <>
      <ChartDefs />

      {loadErr && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ Dashboard query failed: {loadErr}
          {loadErr.includes("57014") && (
            <div style={{ marginTop: 4, color: "#f87171" }}>
              Statement timeout. This is almost never table bloat — measured 2026-07-30, the
              tables were 0% dead rows and still timed out. Check the RLS policies first
              (bare <b>my_role()</b>/<b>my_client_id()</b> calls get re-run per row; they must
              stay wrapped as <b>(select my_role())</b> — see migration 0108), then the query
              plan. Do not simply raise a statement_timeout.
            </div>
          )}
        </div>
      )}
      {filtersErr && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ Filter options query failed (Year/Month/Owner dropdowns will stay empty): {filtersErr}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="filterbar">
        <Sel label={t("Year")}  value={sel.year}  onChange={(v) => setSel((s) => ({ ...s, year: v }))}  opts={filters.years.map(String)} all={t("All Years")} />
        <Sel label={t("Month")} value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={[...filters.months].sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b))} all={t("All Months")} />
        {role === "branch_manager"
          ? (
            /* Owners are hard-scoped to their own scope_owner — no dropdown,
               no other owners' names, and p_owner is forced server-side. */
            <div className="fld">
              <label>{t("Owner")}</label>
              <div style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)", color: "#cdd9f0", fontSize: 13.5, minHeight: 38, display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
                {scopeOwner || "—"}
              </div>
            </div>
          )
          : owners.length > 0 && <Sel label={t("Owner")} value={sel.owner} onChange={pickOwner} opts={owners} all={t("All Owners")} />}
        {brandsForOwner.length > 0 && <Sel label={t("Brand")} value={sel.brand} onChange={pickBrand} opts={brandsForOwner} all={t("All Brands")} />}
        <Sel label={t(storeLabel)} value={sel.store} onChange={pickStore} opts={filteredStores} all={`${t("All")} ${t(storeLabel)}`} />
        <button className="btn-ghost" onClick={() => setSel({ year:"", month:"", city:"", store:"", owner:"", brand:"" })}>{t("Reset")}</button>
        {loading && <Loader />}
      </div>

      {/* ── KPIs (skeleton values while first-loading with no cached data) ── */}
      {(() => {
        const kv = (node: React.ReactNode) => k ? node : <span className="pt-skel" style={{ display:"inline-block", width:64, height:20, verticalAlign:"middle" }} />;
        return (
      <div className="kpi-grid">
        <div className={`kpi kpi-hero${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">💰</div><div className="lbl">{t("Total Sales")}</div><div className="val">{kv(idr(k?.sales ?? 0))}</div>{k && <MiniSparkline data={salesSeries} color={GOLD} />}</div>
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">🧾</div><div className="lbl">{t("Total Transaction")}</div><div className="val">{kv(num(k?.transactions ?? 0))}</div>{k && <MiniSparkline data={transactionSeries} color={BLUE_L} />}</div>
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">👁</div><div className="lbl">{t("Traffic")}</div><div className="val">{kv(num(k?.traffic ?? 0))}</div>{k && <MiniSparkline data={trafficSeries} color={BLUE_L} />}</div>
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">🛒</div><div className="lbl">{t("In-Cart")}</div><div className="val">{kv(num(k?.visitor_cart_adds ?? 0))}</div>{k && <MiniSparkline data={cartAddsSeries} color={BLUE_L} />}</div>
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">📣</div><div className="lbl">{t("Ads Cost")}</div><div className="val">{kv(idr(k?.ad_cost ?? 0))}</div>{k && <MiniSparkline data={adCostSeries} color={BLUE_L} />}</div>
        <div className={`kpi kpi-roas${!k && loading ? " pt-loading-card" : ""}`}>
          <div style={{ position: "absolute", right: 13, top: 12 }}><RadialGauge pct={roasPct} /></div>
          <div className="lbl">{t("ROAS")}</div><div className="val">{kv((k?.roas ? k.roas.toFixed(2) : "0.00")+"×")}</div>
        </div>
      </div>
        );
      })()}

      {/* first-load spinner (no cached data yet) */}
      {loading && !d && <Loader center />}

      {/* ── Monthly/Weekly performance: Traffic vs In-Cart vs Sales ── */}
      <div className="row">
        <Panel title={sel.month ? t("Weekly Performance") : t("Monthly Performance")} hint={t("Traffic vs In-Cart vs Sales · SPOS")}>
          <MonthlySalesChart data={buildPerfTrend(d)} />
        </Panel>
      </div>

      {/* ── Top products + funnel ── */}
      <div className="row c2">
        <Panel title={t("Top 10 Best-Selling Products")} hint={t("Sales · SPOS parent rows")}>
          <HBarsChart data={d?.top_products||[]} />
        </Panel>
        <Panel title={t("Shopping Funnel")} hint={t("Product Views → Visitors → Orders Created → Transactions — older months partly 0 until new SPOS upload")}>
          <FunnelChart productViews={k?.product_views ?? 0} pengunjung={k?.traffic ?? 0} ordersCreated={k?.orders_created ?? 0} transaksi={k?.orders ?? 0} t={t} />
        </Panel>
      </div>

      {/* ── Cost vs ROAS + traffic ── */}
      <div className="row c2b">
        <Panel title={t("Monthly Ads Cost vs ROAS")} hint={t("Bars = cost · line = ROAS")}>
          <CostRoasChart data={byMonth((d?.cost_roas||[]).filter(m=>m.month?.toLowerCase().trim()!=="baseline"))} />
        </Panel>
        <Panel title={t("Traffic vs Add-to-Cart")} hint={t("Funnel trend per month")}>
          <TrafficChart data={byMonth((d?.traffic_trend||[]).filter(m=>m.month?.toLowerCase().trim()!=="baseline"))} />
        </Panel>
      </div>

      {/* ── Sales per Store + Best Campaign Performance ── */}
      <div className="row c2">
        <Panel title={t("AVG Store Sales Performa")} hint={t("Average monthly sales per store · SPOS")}>
          <AvgStoreTrendChart data={d?.avg_store_trend||[]} />
        </Panel>
        <Panel title={t("Best Ads Performance")} hint={t("Top 8 · Views → Clicks → Add to Cart → Sales · from Ads")}>
          <CampaignChart data={d?.top_campaigns||[]} t={t} />
        </Panel>
      </div>

      {/* ── Dealer table ── */}
      <div className="panel">
        <h3>{t("Detail Store Data")}</h3>
        <div className="hint">{t("Sorted by sales · Baseline excluded · line shows SPOS sales trend")} · {t("Click row for details")}</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <SortableHeader label={t(storeLabel)} sortKey="store_name" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} />
              <th>{t("Trend")}</th>
              <SortableHeader label={t("Sales")} sortKey="sales" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} className="num" />
              <SortableHeader label={t("Traffic")} sortKey="traffic" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} className="num" />
              <SortableHeader label={t("In-Cart")} sortKey="in_cart" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} className="num" />
              <SortableHeader label={t("Cart Rate")} sortKey="cart_rate" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} className="num" />
              <SortableHeader label={t("Ads Cost")} sortKey="ad_cost" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} className="num" />
              <th className="num">{t("ROAS Trend")}</th>
              <SortableHeader label={t("ROAS")} sortKey="roas" currentSort={dealersSort.sortConfig} onRequestSort={dealersSort.requestSort} className="num" />
            </tr></thead>
            <tbody>
              {dealersSort.sortedData.map((r, i) => {
                const roasTrend = r.trend?.map((tr) => ({ month: tr.month, value: tr.ad_cost ? tr.sales / tr.ad_cost : 0 }));
                return (
                  <tr key={i} style={{ cursor: "pointer" }} onClick={() => setDrillStore(r)}>
                    <td>{r.store_name}</td>
                    <td><Sparkline data={r.trend?.map((t) => ({ month: t.month, value: t.sales }))} /></td>
                    <td className="num">{idr(r.sales)}</td>
                    <td className="num">{num(r.traffic)}</td>
                    <td className="num">{num(r.in_cart)}</td>
                    <td className="num">{r.cart_rate.toFixed(1)}%</td>
                    <td className="num">{idr(r.ad_cost)}</td>
                    <td className="num"><Sparkline data={roasTrend} /></td>
                    <td className="num">
                      <span className={`pill ${!r.roas?"":r.roas>=3?"good":r.roas>=1?"warn":"bad"}`}>
                        {r.roas ? r.roas.toFixed(2)+"×" : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {dealersSort.sortedData.length===0 && (
                <tr><td colSpan={9} style={{ textAlign:"center", color:"var(--muted)", padding:20 }}>{t("No data yet")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drillStore && (
        <StoreDrillDown store={drillStore} storeLabel={t(storeLabel)} t={t} onClose={() => setDrillStore(null)} />
      )}
    </>
    </UploadGate>
  );
}

/* ═══════════════════════ building blocks ═══════════════════════ */

function Sel({ label, value, onChange, opts, all }: { label:string; value:string; onChange:(v:string)=>void; opts:string[]; all:string }) {
  return (
    <div className="fld"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Panel({ title, children }: { title:string; hint:string; children:React.ReactNode }) {
  return (
    <div className="panel">
      <h3 style={{ margin:"0 0 14px" }}>{title}</h3>
      {children}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ height:280, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted)", fontSize:13 }}>
      No data yet
    </div>
  );
}

// perf_trend from the RPC is already bucketed (month or week); map its
// `bucket` field onto the `month` key MonthlySalesChart expects, drop
// baseline, and sort bucket-aware (chronological months or Week 1…5).
// Falls back to the old monthly merge (monthly_sales + traffic_trend) when
// perf_trend is absent — keeps the chart populated if the frontend deploys
// before migration 0089 runs.
function buildPerfTrend(d: Summary | null): { month: string; sales: number; traffic: number; in_cart: number }[] {
  if (d?.perf_trend?.length) {
    const rows = d.perf_trend
      .filter((r) => r.bucket?.toLowerCase().trim() !== "baseline")
      .map((r) => ({ month: r.bucket, sales: r.sales, traffic: r.traffic, in_cart: r.in_cart }));
    return sortByBucket(rows, "month");
  }
  const salesByMonth = new Map((d?.monthly_sales || []).map((x) => [x.month, x.sales]));
  const trafficByMonth = new Map((d?.traffic_trend || []).map((x) => [x.month, x]));
  const months = [...new Set([...salesByMonth.keys(), ...trafficByMonth.keys()])]
    .filter((m) => m?.toLowerCase().trim() !== "baseline");
  return sortByBucket(months.map((month) => ({
    month,
    sales: salesByMonth.get(month) ?? 0,
    traffic: trafficByMonth.get(month)?.traffic ?? 0,
    in_cart: trafficByMonth.get(month)?.in_cart ?? 0,
  })), "month");
}

/* ── trend sparkline: one smooth line, green = up / red = down, soft glow + faint area ── */
function Sparkline({ data }: { data?: { month: string; value: number }[] }) {
  const pts = (data || []).filter((p) => p.value != null);
  if (pts.length < 2) return null;

  const W = 96, H = 40, PADX = 4, PADY = 6;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = (W - PADX * 2) / (pts.length - 1);
  const coords = vals.map((v, i) => {
    const x = PADX + i * stepX;
    const y = H - PADY - ((v - min) / range) * (H - PADY * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z`;

  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "#22c55e" : "#ef4444";
  const pctChange = vals[0] ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0;
  const [lastX, lastY] = coords[coords.length - 1];
  const gid = `spk-${Math.round(coords[0][1]) + Math.round(lastX)}-${up ? "u" : "d"}`;

  return (
    <span title={`${up ? "▲" : "▼"} ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}% vs first period`}
      style={{ display: "inline-flex", alignItems: "center" }}>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id={`${gid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={color} floodOpacity="0.7" />
          </filter>
        </defs>
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${gid}-glow)`} />
        <circle cx={lastX} cy={lastY} r={2.6} fill={color} filter={`url(#${gid}-glow)`} />
      </svg>
    </span>
  );
}

/* ── mini trend line for a KPI card — replaces the old text sub-label ── */
/* Mountain-style mini area sparkline (gradient fill under a glowing line) — replaces the old plain polyline */
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const gid = "msg-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (data.length < 2) return <div style={{ height: 30 }} />;
  const w = 100, h = 30, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (w - 2 * pad) / (data.length - 1);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const coords = data.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = coords.map(([x, cy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${cy.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  const area = `${line} L${lastX.toFixed(1)},${h} L${coords[0][0].toFixed(1)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 30, marginTop: 6, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
      <circle cx={lastX} cy={lastY} r={2.6} fill={color} />
    </svg>
  );
}

/* ── Shopping funnel: Traffic → In-Cart → Orders (real typed fields only —
     "clicks" isn't captured anywhere in this schema, so it's not shown).
     Tapered trapezoid shape, blue narrowing down to gold at the final
     (revenue-generating) stage — our own identity, not a copied palette. ── */
function FunnelChart({ productViews, pengunjung, ordersCreated, transaksi, t }: {
  productViews: number; pengunjung: number; ordersCreated: number; transaksi: number; t: (k: string) => string;
}) {
  const isMobile = useIsMobile();
  // Gate on ANY stage having data, not just productViews specifically —
  // productViews/ordersCreated are brand-new fields that read 0 for every
  // pre-existing upload, which was blanking the whole chart even when
  // Pengunjung/Transaksi (older fields) have real data.
  if (!productViews && !pengunjung && !ordersCreated && !transaksi) return <Empty />;
  const stages = [
    { label: t("Product Views"), value: productViews },
    { label: t("Visitors"), value: pengunjung },
    { label: t("Orders Created"), value: ordersCreated },
    { label: t("Transactions"), value: transaksi },
  ];
  // On mobile the side-by-side layout squeezed the label column to nothing
  // (labels/numbers were getting clipped) — shrink the SVG and stack it
  // above a full-width list instead of beside it.
  const W = isMobile ? 150 : 240, H = isMobile ? 190 : 300;
  const segH = H / stages.length;
  const minW = W * 0.24;
  // Scale against whichever stage is actually largest (not always stage 0 —
  // productViews reads 0 until re-uploaded, so Pengunjung is often the real
  // peak right now). Then cascade-clamp so every later segment is never
  // WIDER than the one above it — a funnel must taper monotonically, even
  // when a brand-new field (0 for old uploads) sits between two stages that
  // both have real data, which previously made it flare back out.
  const max = Math.max(productViews, pengunjung, ordersCreated, transaksi, 1);
  const widths: number[] = [];
  stages.forEach((s, i) => {
    const raw = minW + (W - minW) * Math.max(s.value / max, 0.06);
    widths.push(i === 0 ? raw : Math.min(raw, widths[i - 1]));
  });

  // Standard funnel convention: each stage as a % of the TOP stage, so it's
  // always monotonic and reads cleanly (no confusing >100% steps that a
  // relative-to-previous calc produces when a later stage happens to be
  // larger). Small values keep one decimal so they don't all collapse to 0%.
  const topVal = stages[0].value || 0;
  const pctOfTop = (v: number): number | null => (topVal ? (v / topVal) * 100 : null);
  const fmtPct = (p: number) => (p >= 10 ? p.toFixed(0) : p.toFixed(1));

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 22, alignItems: isMobile ? "flex-start" : "center", padding: "6px 4px" }}>
      <svg width={W} height={H} style={{ flexShrink: 0, overflow: "visible", alignSelf: isMobile ? "center" : undefined }}>
        <defs>
          {/* One continuous gradient sweep spanning the full funnel — blue (top,
              broad reach) flowing down into a muted gold (bottom, the
              narrower converted slice) — our own identity, no bright yellow. */}
          <linearGradient id="funnel-sweep" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={BLUE_L} />
            <stop offset="55%" stopColor={BLUE} />
            <stop offset="100%" stopColor={GOLD} />
          </linearGradient>
        </defs>
        {stages.map((s, i) => {
          const y = i * segH;
          const wTop = widths[i], wBot = widths[i + 1] ?? widths[i] * 0.62;
          const xTop = (W - wTop) / 2, xBot = (W - wBot) / 2;
          const gap = 4;
          const pts = `${xTop},${y} ${xTop + wTop},${y} ${xBot + wBot},${y + segH - gap} ${xBot},${y + segH - gap}`;
          const pct = pctOfTop(s.value);
          return (
            <g key={i}>
              <polygon points={pts} fill="url(#funnel-sweep)" style={{ filter: "drop-shadow(0 0 10px rgba(59,130,246,0.35))" }} />
              <text x={W / 2} y={y + segH / 2 - gap / 2 + 5} textAnchor="middle" fontSize={isMobile ? 11 : 15} fontWeight={800} fill="#fff" style={{ textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>
                {pct == null ? "—" : `${fmtPct(pct)}%`}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ flex: 1, width: isMobile ? "100%" : undefined, display: "flex", flexDirection: "column", gap: isMobile ? 14 : 22, minWidth: 0 }}>
        {stages.map((s) => (
          <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: isMobile ? 11 : 12.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>{s.label}</span>
            <span style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, color: "#fff", textAlign: "right", whiteSpace: "nowrap" }}>{num(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Best Campaign Performance: horizontal bars ranked by sales, views annotated ── */
/* ── Best Ads Performance — ranked list with the full funnel per campaign
     (Dilihat -> Klik -> Add to Cart -> Omzet), not just a single bar, so it
     doubles as a recommendation view: a campaign with high Dilihat but weak
     CTR/cart-rate stands out immediately against one that converts well. ── */
function CampaignChart({ data, t }: { data: { name: string; store_name: string | null; views: number; clicks: number; add_to_cart: number; orders: number; sales: number; ad_cost: number }[]; t: (k: string) => string }) {
  if (!data.length) return <Empty />;
  const max = Math.max(...data.map((r) => r.sales), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 2px", maxHeight: 320, overflowY: "auto" }}>
      {data.map((c, i) => {
        const ctr = c.views ? (c.clicks / c.views) * 100 : 0;
        const cartRate = c.clicks ? (c.add_to_cart / c.clicks) * 100 : 0;
        const widthPct = Math.max((c.sales / max) * 100, 3);
        return (
          <div key={i} style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 5 }}>
              <span style={{ fontSize: 12, color: "#e8edf8", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i + 1}. {c.store_name && <span style={{ color: BLUE_L }}>{c.store_name}</span>} {c.store_name && "- "}{c.name}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: GOLD, whiteSpace: "nowrap" }}>{idr(c.sales)}</span>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 99, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ width: `${widthPct}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${BLUE}, ${BLUE_L})`, boxShadow: `0 0 8px ${BLUE}66` }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--muted)" }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", rowGap: 4 }}>
                <span>👁 {num(c.views)} {t("Views")}</span>
                <span>🖱 {num(c.clicks)} {t("Clicks")} <span style={{ color: BLUE_L }}>({ctr.toFixed(1)}%)</span></span>
                <span>🛒 {num(c.add_to_cart)} {t("In-Cart")} <span style={{ color: GOLD_L }}>({cartRate.toFixed(1)}%)</span></span>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", rowGap: 4 }}>
                <span>💰 {idr(c.ad_cost)} {t("Ads Cost")}</span>
                <span>🎯 {c.ad_cost ? (c.sales / c.ad_cost).toFixed(2) + "×" : "—"} {t("ROAS")}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
