"use client";

// Ads Performance overview — Total Ads as 7 individual KPI cards (matching
// the main Dashboard's .kpi-grid markup), 3 category cards (GMV Max /
// Group Ads / Independent Ads), a Sales-by-type chart, a View→Click→Add to
// Cart→Order funnel, an Item Sold vs Sales trend, and two tables (Ads Group
// Performance, Ads Product Performance). Colors are restricted to the
// app's own gold/blue palette — gold reserved for the single hero number
// and ROAS (as a gradient, matching the Dashboard's .grad-gold treatment,
// never solid), everything else blue. recharts only loads here, split via
// next/dynamic in page.tsx — same convention as DashboardCharts.tsx.
import { useCallback, useEffect, useState } from "react";
import {
  Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";
import Loader from "@/components/Loader";
import { useTableSort } from "@/hooks/useTableSort";
import SortableHeader from "@/components/SortableHeader";

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

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const SHORT_MONTH: Record<string, string> = {
  Baseline:"Base", Januari:"Jan", Februari:"Feb", Maret:"Mar", April:"Apr",
  Mei:"Mei", Juni:"Jun", Juli:"Jul", Agustus:"Agu", September:"Sep",
  Oktober:"Okt", November:"Nov", Desember:"Des",
};
const sm = (m: string) => SHORT_MONTH[m] ?? (m || "").slice(0, 3);
const byMonth = <T extends { month: string }>(a: T[]) =>
  [...(a || [])].sort((x, y) => MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month));

const idr  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const idrF = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const num  = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const roasF = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(2) + "×");

// Brand palette — gold is reserved for the hero number + ROAS (gradient,
// never solid); everything else is blue, matching the request to lean
// blue with only a small gold accent.
const GOLD = "#c9a227", GOLD_L = "#f0d870", BLUE = "#3b82f6", BLUE_L = "#60a5fa", BLUE_PALE = "#93c5fd";

const TIP_STYLE: React.CSSProperties = {
  background: "rgba(6,14,33,0.97)", border: "1px solid rgba(201,162,39,0.35)", borderRadius: 10,
  color: "#e8edf8", fontSize: 12, padding: "8px 14px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
};
const axis = { fontSize: 10, fill: "#7089aa" };

type Totals = { ads_cost: number; sales: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type MonthRow = { month: string; gmv_max_sales: number; group_sales: number; independent_sales: number; roas: number | null };
type SoldSalesRow = { month: string; item_sold: number; sales: number };
type Funnel = { view: number; click: number; add_to_cart: number; orders: number };
type GroupRow = { nama_iklan: string | null; ads_cost: number; sales: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type ProductRow = { kode_produk: string; nama_produk: string | null; ads_cost: number; sales: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type Summary = {
  totals: { total: Totals; gmv_max: Totals; group_ads: Totals; independent: Totals };
  funnel: Funnel;
  monthly: MonthRow[]; sold_sales_trend: SoldSalesRow[];
  groups: GroupRow[]; products: ProductRow[];
};
type Filters = { years: number[]; months: string[] };
type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };

export default function AdsOverview({ clientId, refreshKey }: { clientId: string; refreshKey?: number }) {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [filtersErr, setFiltersErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>({ years: [], months: [] });
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", owner: "", brand: "", store: "" });

  const metaCacheKey = `ptoko_ads_meta_v1:${clientId}`;

  // Filters/links load once per client — independent of the summary query,
  // same split the main Dashboard uses (dashboard_filters + store_links).
  useEffect(() => {
    if (!clientId) return;
    try {
      const raw = localStorage.getItem(metaCacheKey);
      if (raw) {
        const m = JSON.parse(raw) as { filters?: Filters; links?: StoreLink[] };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (m.filters) setFilters(m.filters);
        if (m.links) setLinks(m.links);
      }
    } catch { /* ignore */ }

    (async () => {
      const [{ data: f, error: fErr }, { data: sl, error: slErr }] = await Promise.all([
        supabase.rpc("ads_rollup_filters"),
        supabase.from("store_links").select("owner,brand,store_name").eq("client_id", clientId).order("owner"),
      ]);
      const rpcErr = fErr || slErr;
      setFiltersErr(rpcErr ? `${rpcErr.message} (code: ${rpcErr.code || "?"})` : "");
      if (f) setFilters(f as Filters);
      setLinks((sl as StoreLink[]) || []);
      try { localStorage.setItem(metaCacheKey, JSON.stringify({ filters: f, links: sl })); } catch { /* quota */ }
    })();
  }, [clientId, supabase, metaCacheKey]);

  const cacheKey = `ptoko_ads_v2:${clientId}:${JSON.stringify(sel)}`;

  const load = useCallback(async () => {
    if (!clientId) return;
    // Stale-while-revalidate: paint the last-seen result instantly (huge
    // win on re-entry — this query can take a few seconds), then refresh
    // in the background. Same pattern the main Dashboard uses.
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) setD(JSON.parse(raw) as Summary);
    } catch { /* ignore */ }

    setLoading(true);
    const { data, error } = await supabase.rpc("ads_dashboard_summary", {
      p_year:  sel.year  ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_owner: sel.owner || null,
      p_brand: sel.brand || null,
      p_store: sel.store || null,
    });
    if (error) setErr(`${error.message} (code: ${error.code || "?"})`);
    else {
      setD(data as Summary);
      setErr("");
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
    }
    setLoading(false);
  }, [clientId, supabase, cacheKey, sel]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, refreshKey]);

  const owners = Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort();
  const brandsForOwner = sel.owner
    ? Array.from(new Set(links.filter((l) => l.owner === sel.owner).map((l) => l.brand).filter(Boolean) as string[])).sort()
    : Array.from(new Set(links.map((l) => l.brand).filter(Boolean) as string[])).sort();
  const storesForBrandOwner = (() => {
    let base = links;
    if (sel.brand) base = base.filter((l) => l.brand === sel.brand);
    if (sel.owner) base = base.filter((l) => l.owner === sel.owner);
    return Array.from(new Set(base.map((l) => l.store_name).filter(Boolean) as string[])).sort();
  })();
  function pickOwner(owner: string) { setSel((s) => ({ ...s, owner, brand: "", store: "" })); }
  function pickBrand(brand: string) { setSel((s) => ({ ...s, brand, store: "" })); }
  function pickStore(store: string) {
    const link = links.find((l) => l.store_name === store);
    setSel((s) => ({ ...s, store, owner: link?.owner || s.owner, brand: link?.brand || s.brand }));
  }

  // Hooks must run unconditionally (before the !d early returns below), so
  // these use a safe [] fallback rather than being called after the guard.
  const groupsSort = useTableSort<GroupRow>(d?.groups ?? [], "sales");
  const productsSort = useTableSort<ProductRow>(d?.products ?? [], "sales");

  const filterBar = (
    <>
      {filtersErr && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ Filter options query failed (Year/Month/Owner dropdowns will stay empty): {filtersErr}
        </div>
      )}
      <div className="filterbar">
        <Sel label={t("Year")} value={sel.year} onChange={(v) => setSel((s) => ({ ...s, year: v }))} opts={filters.years.map(String)} all={t("All Years")} />
        <Sel label={t("Month")} value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={filters.months} all={t("All Months")} />
        {owners.length > 0 && <Sel label={t("Owner")} value={sel.owner} onChange={pickOwner} opts={owners} all={t("All Owners")} />}
        {brandsForOwner.length > 0 && <Sel label={t("Brand")} value={sel.brand} onChange={pickBrand} opts={brandsForOwner} all={t("All Brands")} />}
        <Sel label={t("Store")} value={sel.store} onChange={pickStore} opts={storesForBrandOwner} all={t("All Stores")} />
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", owner: "", brand: "", store: "" })}>{t("Reset")}</button>
        {loading && <Loader />}
      </div>
    </>
  );

  if (err && !d) {
    return (
      <>
        {filterBar}
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ Ads overview query failed: {err}
        </div>
      </>
    );
  }
  if (!d) {
    return (
      <>
        {filterBar}
        <div className="panel" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>{t("Loading data…")}</div>
      </>
    );
  }

  const totals = d.totals;
  const monthly = byMonth(d.monthly);
  const soldSales = byMonth(d.sold_sales_trend);

  return (
    <>
      {filterBar}
      {err && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "10px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 12, fontFamily: "monospace" }}>
          ⚠ Refresh failed, showing last-known data: {err}
        </div>
      )}

      {/* ── Total Ads: 7 individual KPI cards. Sales is the one hero (gold
          gradient) number, ROAS is gold-gradient text on an otherwise
          plain card, everything else is the default blue card. ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(7,1fr)" }}>
        <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">{t("Ads Cost")}</div><div className="val">{idr(totals.total.ads_cost)}</div></div>
        <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">{t("Sales")}</div><div className="val">{idr(totals.total.sales)}</div></div>
        <div className="kpi"><div className="lbl">{t("ROAS")}</div><div className="val grad-gold">{roasF(totals.total.roas)}</div></div>
        <div className="kpi"><div className="kpi-icon">👁</div><div className="lbl">{t("View")}</div><div className="val">{num(totals.total.view)}</div></div>
        <div className="kpi"><div className="kpi-icon">🖱</div><div className="lbl">{t("Click")}</div><div className="val">{num(totals.total.click)}</div></div>
        <div className="kpi"><div className="kpi-icon">🧾</div><div className="lbl">{t("Order")}</div><div className="val">{num(totals.total.orders)}</div></div>
        <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">{t("Item Sold")}</div><div className="val">{num(totals.total.item_sold)}</div></div>
      </div>

      {/* ── GMV Max / Group Ads / Independent Ads ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        <CategoryCard title="GMV Max Auto" accent={BLUE} totals={totals.gmv_max} t={t} />
        <CategoryCard title={t("Group Ads")} accent={BLUE_L} totals={totals.group_ads} t={t} />
        <CategoryCard title={t("Independent Ads")} accent={BLUE_PALE} totals={totals.independent} sub="Total − GMV Max − Group" t={t} />
      </div>

      {/* ── charts ── */}
      <div className="row c2" style={{ marginBottom: 18 }}>
        <Panel title={t("Sales by Ads Type")} hint="Stacked: GMV Max → Group → Independent · line = overall ROAS">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={monthly} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={sm} tick={axis} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={axis} axisLine={false} tickLine={false} tickFormatter={idr} />
              <YAxis yAxisId="right" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "×"} />
              <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => n === "ROAS" ? [roasF(Number(v)), n] : [idrF(Number(v)), n]} labelFormatter={(l) => sm(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="gmv_max_sales" stackId="s" name="GMV Max Auto" fill={BLUE} radius={[0,0,0,0]} />
              <Bar yAxisId="left" dataKey="group_sales" stackId="s" name="Group Ads" fill={BLUE_L} radius={[0,0,0,0]} />
              <Bar yAxisId="left" dataKey="independent_sales" stackId="s" name="Independent Ads" fill={BLUE_PALE} radius={[3,3,0,0]} />
              <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke={GOLD_L} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={t("Ads Funnel")} hint="Dilihat → Klik → Add to Cart → Konversi · Total Ads">
          <AdsFunnel funnel={d.funnel} t={t} />
        </Panel>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <Panel title={t("Item Sold vs Sales")} hint="Produk Terjual vs Omzet Penjualan · Total Ads · separate scales">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={soldSales} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={sm} tick={axis} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={axis} axisLine={false} tickLine={false} tickFormatter={num} />
              <YAxis yAxisId="right" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={idr} />
              <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => n === "Sales" ? [idrF(Number(v)), n] : [num(Number(v)), n]} labelFormatter={(l) => sm(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="item_sold" name="Item Sold" stroke={BLUE_L} strokeWidth={2} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="sales" name="Sales" stroke={GOLD_L} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* ── Ads Group Performance (level='group' rows — no Kode Produk) ── */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>{t("Ads Group Performance")}</h3>
        <div className="hint" style={{ marginBottom: 14 }}>{t("Campaign / group-level rows (GMV Max, Grup Hero, Grup Regular, etc.) — everything without a Kode Produk")}</div>
        <div className="tbl-wrap" style={{ maxHeight: 360 }}>
          <table className="tbl">
            <thead>
              <tr>
                <SortableHeader label={t("Campaign Name")} sortKey="nama_iklan" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} />
                <SortableHeader label={t("Ads Cost")} sortKey="ads_cost" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
                <SortableHeader label={t("Sales")} sortKey="sales" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
                <SortableHeader label={t("ROAS")} sortKey="roas" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
                <SortableHeader label={t("View")} sortKey="view" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
                <SortableHeader label={t("Click")} sortKey="click" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
                <SortableHeader label={t("Order")} sortKey="orders" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
                <SortableHeader label={t("Item Sold")} sortKey="item_sold" currentSort={groupsSort.sortConfig} onRequestSort={groupsSort.requestSort} className="num" />
              </tr>
            </thead>
            <tbody>
              {groupsSort.sortedData.map((g, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{g.nama_iklan || "—"}</td>
                  <td className="num">{idrF(g.ads_cost)}</td>
                  <td className="num">{idrF(g.sales)}</td>
                  <td className="num grad-gold" style={{ fontWeight: 700 }}>{roasF(g.roas)}</td>
                  <td className="num">{num(g.view)}</td>
                  <td className="num">{num(g.click)}</td>
                  <td className="num">{num(g.orders)}</td>
                  <td className="num">{num(g.item_sold)}</td>
                </tr>
              ))}
              {groupsSort.sortedData.length === 0 && (
                <tr><td colSpan={8} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>{t("No campaign/group ads data yet")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Ads Product Performance (level='product' rows — has Kode Produk) ── */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>{t("Ads Product Performance")}</h3>
        <div className="hint" style={{ marginBottom: 14 }}>{t("Merged from Total Ads, GMV Max, and Group Ads · joined on Kode Produk")}</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead>
              <tr>
                <SortableHeader label={t("Product Code")} sortKey="kode_produk" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} />
                <SortableHeader label={t("Product Name")} sortKey="nama_produk" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} />
                <SortableHeader label={t("Ads Cost")} sortKey="ads_cost" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
                <SortableHeader label={t("Sales")} sortKey="sales" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
                <SortableHeader label={t("ROAS")} sortKey="roas" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
                <SortableHeader label={t("View")} sortKey="view" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
                <SortableHeader label={t("Click")} sortKey="click" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
                <SortableHeader label={t("Order")} sortKey="orders" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
                <SortableHeader label={t("Item Sold")} sortKey="item_sold" currentSort={productsSort.sortConfig} onRequestSort={productsSort.requestSort} className="num" />
              </tr>
            </thead>
            <tbody>
              {productsSort.sortedData.map((p) => (
                <tr key={p.kode_produk}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--muted)" }}>{p.kode_produk}</td>
                  <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.nama_produk || ""}>{p.nama_produk || "—"}</td>
                  <td className="num">{idrF(p.ads_cost)}</td>
                  <td className="num">{idrF(p.sales)}</td>
                  <td className="num grad-gold" style={{ fontWeight: 700 }}>{roasF(p.roas)}</td>
                  <td className="num">{num(p.view)}</td>
                  <td className="num">{num(p.click)}</td>
                  <td className="num">{num(p.orders)}</td>
                  <td className="num">{num(p.item_sold)}</td>
                </tr>
              ))}
              {productsSort.sortedData.length === 0 && (
                <tr><td colSpan={9} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>{t("No product-level ads data yet")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Sel({ label, value, onChange, opts, all }: { label: string; value: string; onChange: (v: string) => void; opts: string[]; all: string }) {
  return (
    <div className="fld"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function CategoryCard({ title, accent, totals, sub, t }: { title: string; accent: string; totals: Totals; sub?: string; t: (k: string) => string }) {
  return (
    <div style={{ background: "linear-gradient(160deg,rgba(22,40,76,.7),rgba(9,17,36,.62))", border: `1px solid ${accent}40`, borderRadius: 16, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: .4 }}>{title}</div>
          {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
        </div>
        <div className="grad-gold" style={{ fontSize: 15, fontWeight: 800 }}>{roasF(totals.roas)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("Ads Cost")}</span>
        <span style={{ fontSize: 19, fontWeight: 800, color: "#fff" }}>{idrF(totals.ads_cost)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 10, columnGap: 8, fontSize: 12 }}>
        <Metric label={t("Sales")} value={idr(totals.sales)} />
        <Metric label={t("View")} value={num(totals.view)} />
        <Metric label={t("Click")} value={num(totals.click)} />
        <Metric label={t("Order")} value={num(totals.orders)} />
        <Metric label={t("Item Sold")} value={num(totals.item_sold)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "#cdd9f0", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 10px" }}>{title}</h3>
      {children}
    </div>
  );
}

// Same visual design as the main Dashboard's Shopping Funnel (blue-to-gold
// gradient trapezoid, monotonically-tapering widths, % of top stage) —
// duplicated rather than imported so this lazy-loaded chunk stays
// independent, same convention DashboardCharts.tsx documents for itself.
function AdsFunnel({ funnel, t }: { funnel: Funnel; t: (k: string) => string }) {
  const isMobile = useIsMobile();
  const { view, click, add_to_cart, orders } = funnel;
  if (!view && !click && !add_to_cart && !orders) {
    return <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0", fontSize: 13 }}>{t("No ads funnel data yet")}</div>;
  }
  const stages = [
    { label: t("View"), value: view },
    { label: t("Click"), value: click },
    { label: t("Add to Cart"), value: add_to_cart },
    { label: t("Order"), value: orders },
  ];
  const W = isMobile ? 150 : 220, H = isMobile ? 190 : 260;
  const segH = H / stages.length;
  const minW = W * 0.24;
  const max = Math.max(view, click, add_to_cart, orders, 1);
  const widths: number[] = [];
  stages.forEach((s, i) => {
    const raw = minW + (W - minW) * Math.max(s.value / max, 0.06);
    widths.push(i === 0 ? raw : Math.min(raw, widths[i - 1]));
  });
  const topVal = stages[0].value || 0;
  const pctOfTop = (v: number): number | null => (topVal ? (v / topVal) * 100 : null);
  const fmtPct = (p: number) => (p >= 10 ? p.toFixed(0) : p.toFixed(1));

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 22, alignItems: isMobile ? "flex-start" : "center", padding: "6px 4px" }}>
      <svg width={W} height={H} style={{ flexShrink: 0, overflow: "visible", alignSelf: isMobile ? "center" : undefined }}>
        <defs>
          <linearGradient id="ads-funnel-sweep" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
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
              <polygon points={pts} fill="url(#ads-funnel-sweep)" style={{ filter: "drop-shadow(0 0 10px rgba(59,130,246,0.35))" }} />
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
