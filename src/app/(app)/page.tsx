"use client";

import { useEffect, useState, useCallback, useId } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, AreaChart, Area, Cell, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Summary = {
  kpis: { sales: number; gmv: number; traffic: number; in_cart: number; orders: number; ad_cost: number; roas: number | null };
  monthly_sales: { month: string; sales: number }[];
  store_monthly: { month: string; gmv: number }[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  cost_roas: { month: string; cost: number; roas: number | null }[];
  traffic_trend: { month: string; traffic: number; in_cart: number }[];
  top_campaigns: { name: string; views: number; orders: number; sales: number; ad_cost: number }[];
  dealers: { store_name: string; city: string; sales: number; traffic: number; in_cart: number; orders: number; ad_cost: number; roas: number | null; trend?: { month: string; sales: number; ad_cost: number | null }[] }[];
};
type Filters = { years: number[]; months: string[]; cities: string[]; stores: string[] };
type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const SHORT_MONTH: Record<string, string> = {
  Baseline:"Base", Januari:"Jan", Februari:"Feb", Maret:"Mar", April:"Apr",
  Mei:"Mei", Juni:"Jun", Juli:"Jul", Agustus:"Agu", September:"Sep",
  Oktober:"Okt", November:"Nov", Desember:"Des",
};
const sm = (m: string) => SHORT_MONTH[m] ?? m.slice(0, 3);
const byMonth = <T extends { month: string }>(a: T[]) =>
  [...(a || [])].sort((x, y) => MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month));

const idr  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const idrF = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const num  = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

const GOLD   = "#c9a227";
const GOLD_L = "#f0d870";
const BLUE   = "#3b82f6";
const BLUE_L = "#60a5fa";

/* ─── SVG gradient + filter defs (referenced via url(#id) across all charts) ─── */
function ChartDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }}>
      <defs>
        {/* Gold bar gradient */}
        <linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#f5e070" />
          <stop offset="100%" stopColor="#8a6510" />
        </linearGradient>
        {/* Navy bar gradient */}
        <linearGradient id="gNavy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#4a8fd4" />
          <stop offset="100%" stopColor="#0c1e40" />
        </linearGradient>
        {/* Traffic area gradient */}
        <linearGradient id="gTraffic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#94a3b8" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.02" />
        </linearGradient>
        {/* In-cart area gradient — blue, gold reserved for the true highlight metrics */}
        <linearGradient id="gCart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={BLUE_L} stopOpacity="0.7" />
          <stop offset="100%" stopColor={BLUE_L} stopOpacity="0.02" />
        </linearGradient>
        {/* Cost area gradient */}
        <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={BLUE_L} stopOpacity="0.65" />
          <stop offset="100%" stopColor={BLUE_L} stopOpacity="0.02" />
        </linearGradient>
        {/* Glow filter */}
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Soft ground shadow under 3D bars */}
        <filter id="barShadow" x="-60%" y="-20%" width="220%" height="180%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        {/* Right-side face shading (adds a subtle gradient instead of flat black) */}
        <linearGradient id="gSide" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="rgba(0,0,0,0.15)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

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

/* ─── 3-D bar shape ─── */
function Bar3D(props: Record<string, unknown>) {
  const x = props.x as number ?? 0;
  const y = props.y as number ?? 0;
  const w = props.width as number ?? 0;
  const h = props.height as number ?? 0;
  const fill = props.fill as string ?? GOLD;
  const baseY = y + h;
  if (!h || h < 1 || !w || w < 1) return null;

  const d  = Math.min(w * 0.24, 12);   // horizontal depth
  const dv = d * 0.55;                  // vertical depth (perspective angle)
  const rx = 3;

  return (
    <g>
      {/* soft ambient shadow on the ground plane below the bar */}
      <ellipse cx={x + w / 2} cy={baseY + 2} rx={w / 2 + d * 0.4} ry={3.2} fill="rgba(0,0,0,0.4)" filter="url(#barShadow)" />
      <g filter="url(#glow)">
        {/* front face */}
        <rect x={x} y={y} width={w} height={h} fill={fill} rx={rx} />
        {/* subtle vertical sheen on the front face for extra polish */}
        <rect x={x} y={y} width={w} height={Math.min(h, h * 0.4)} fill="rgba(255,255,255,0.08)" rx={rx} />
        {/* top face */}
        <path
          d={`M${x},${y} L${x+d},${y-dv} L${x+w+d},${y-dv} L${x+w},${y} Z`}
          fill="rgba(255,255,255,0.3)"
        />
        {/* right side face — gradient instead of flat shade for more depth */}
        <path
          d={`M${x+w},${y} L${x+w+d},${y-dv} L${x+w+d},${y+h-dv} L${x+w},${y+h} Z`}
          fill="url(#gSide)"
        />
        {/* top edge highlight */}
        <line x1={x} y1={y} x2={x+w} y2={y} stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} />
      </g>
    </g>
  );
}

/* ─── Horizontal 3D bar shape ─── */
function HBar3D(props: Record<string, unknown>) {
  const x = props.x as number ?? 0;
  const y = props.y as number ?? 0;
  const w = props.width as number ?? 0;
  const h = props.height as number ?? 0;
  const fill = props.fill as string ?? GOLD;
  if (!w || w < 1 || !h || h < 1) return null;

  const d  = Math.min(h * 0.3, 8);
  const dv = d * 0.55;

  return (
    <g>
      {/* front */}
      <rect x={x} y={y} width={w} height={h} fill={fill} rx={2} />
      {/* top face */}
      <path d={`M${x},${y} L${x+dv},${y-d} L${x+w+dv},${y-d} L${x+w},${y} Z`} fill="rgba(255,255,255,0.22)" />
      {/* right side */}
      <path d={`M${x+w},${y} L${x+w+dv},${y-d} L${x+w+dv},${y+h-d} L${x+w},${y+h} Z`} fill="rgba(0,0,0,0.30)" />
    </g>
  );
}

/* ─── Custom tooltip ─── */
const TIP_STYLE: React.CSSProperties = {
  background: "rgba(6,14,33,0.97)",
  border: "1px solid rgba(201,162,39,0.35)",
  borderRadius: 10,
  color: "#e8edf8",
  fontSize: 12,
  padding: "8px 14px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  backdropFilter: "blur(8px)",
};
const axis = { fontSize: 10, fill: "#7089aa" };

export default function DashboardPage() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [storeLabel, setStoreLabel] = useState("Store");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], cities: [], stores: [] });
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "", owner: "", brand: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    (async () => {
      // paint filter bar + store label instantly from last session's cache
      try {
        const raw = localStorage.getItem("ptoko_dash_meta_v2");
        if (raw) {
          const m = JSON.parse(raw) as { filters?: Filters; links?: StoreLink[]; storeLabel?: string };
          if (m.filters) setFilters(m.filters);
          if (m.links) setLinks(m.links);
          if (m.storeLabel) setStoreLabel(m.storeLabel);
        }
      } catch { /* ignore */ }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      let label = "Store";
      const { data: p } = await supabase.from("profiles").select("client_id").eq("id", user.id).single();
      if (p?.client_id) {
        const { data: c } = await supabase.from("clients").select("store_label").eq("id", p.client_id).single();
        if (c?.store_label) { label = c.store_label; setStoreLabel(label); }
      }
      const [{ data: f }, { data: sl }] = await Promise.all([
        supabase.rpc("dashboard_filters"),
        supabase.from("store_links").select("owner,brand,store_name").order("owner"),
      ]);
      if (f) setFilters(f as Filters);
      setLinks((sl as StoreLink[]) || []);
      try {
        localStorage.setItem("ptoko_dash_meta_v2", JSON.stringify({ filters: f, links: sl, storeLabel: label }));
      } catch { /* quota */ }
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    // Stale-while-revalidate: paint the last-seen result for this exact filter
    // selection instantly from localStorage (huge mobile win — no blank wait
    // for the ~5s query), then refresh in the background.
    const cacheKey = "ptoko_dash_v2:" + JSON.stringify(sel);
    let hadCache = false;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) { setD(JSON.parse(raw) as Summary); hadCache = true; }
    } catch { /* ignore */ }

    setLoading(true);
    const { data, error } = await supabase.rpc("dashboard_summary", {
      p_year:  sel.year  ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city:  sel.city  || null,
      p_owner: sel.owner || null,
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
  }, [supabase, sel]);
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
  const cartRate = k && k.traffic ? (k.in_cart / k.traffic) * 100 : 0;
  const salesSeries   = byMonth(d?.monthly_sales || []).map((x) => x.sales);
  const gmvSeries      = byMonth(d?.store_monthly || []).map((x) => x.gmv);
  const trafficSeries  = byMonth(d?.traffic_trend || []).map((x) => x.traffic);
  const inCartSeries   = byMonth(d?.traffic_trend || []).map((x) => x.in_cart);
  const adCostSeries   = byMonth(d?.cost_roas || []).map((x) => x.cost);
  const [drillStore, setDrillStore] = useState<Summary["dealers"][number] | null>(null);

  return (
    <>
      <ChartDefs />

      {loadErr && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ Dashboard query failed: {loadErr}
          {loadErr.includes("57014") && (
            <div style={{ marginTop: 4, color: "#f87171" }}>
              Statement timeout — table bloat from repeated uploads is slowing this query down again. Run <b>VACUUM (FULL, ANALYZE) sales_rows;</b> in the Supabase SQL Editor (as its own query, not inside a migration) to fix it.
            </div>
          )}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="filterbar">
        <Sel label={t("Year")}  value={sel.year}  onChange={(v) => setSel((s) => ({ ...s, year: v }))}  opts={filters.years.map(String)} all={t("All Years")} />
        <Sel label={t("Month")} value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={filters.months} all={t("All Months")} />
        <Sel label={t("City")}  value={sel.city}  onChange={(v) => setSel((s) => ({ ...s, city: v }))}  opts={filters.cities} all={t("All Cities")} />
        {owners.length > 0 && <Sel label={t("Owner")} value={sel.owner} onChange={pickOwner} opts={owners} all={t("All Owners")} />}
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
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">🏪</div><div className="lbl">{t("Total GMV")}</div><div className="val">{kv(idr(k?.gmv ?? 0))}</div>{k && <MiniSparkline data={gmvSeries} color={BLUE_L} />}</div>
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">👁</div><div className="lbl">{t("Traffic")}</div><div className="val">{kv(num(k?.traffic ?? 0))}</div>{k && <MiniSparkline data={trafficSeries} color={BLUE_L} />}</div>
        <div className={`kpi${!k && loading ? " pt-loading-card" : ""}`}><div className="kpi-icon">🛒</div><div className="lbl">{t("In-Cart")}</div><div className="val">{kv(num(k?.in_cart ?? 0))} {k ? <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>· {cartRate.toFixed(1)}%</span> : null}</div>{k && <MiniSparkline data={inCartSeries} color={BLUE_L} />}</div>
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

      {/* ── Monthly performance: Traffic vs In-Cart vs Sales ── */}
      <div className="row">
        <Panel title={t("Monthly Performance")} hint={t("Traffic vs In-Cart vs Sales · SPOS")}>
          <MonthlySalesChart data={buildMonthlyPerf(d)} />
        </Panel>
      </div>

      {/* ── Top products + funnel ── */}
      <div className="row c2">
        <Panel title={t("Top 10 Best-Selling Products")} hint={t("Sales · SPOS parent rows")}>
          <HBarsChart data={d?.top_products||[]} />
        </Panel>
        <Panel title={t("Shopping Funnel")} hint={t("Traffic → In-Cart → Sales (pc) — Klik produk belum tersedia di data")}>
          <FunnelChart traffic={k?.traffic ?? 0} inCart={k?.in_cart ?? 0} orders={k?.orders ?? 0} t={t} />
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
        <Panel title={t("Sales per Store")} hint={t("Total SPOS sales per store · baseline excluded")}>
          <StoreSalesChart data={d?.dealers||[]} />
        </Panel>
        <Panel title={t("Best Campaign Performance")} hint={t("Top 8 · Dilihat + Penjualan · sumber Ads (Klik & Masuk Keranjang belum tersedia — perlu upload Grup Iklan)")}>
          <CampaignChart data={d?.top_campaigns||[]} />
        </Panel>
      </div>

      {/* ── Dealer table ── */}
      <div className="panel">
        <h3>{t("Detail Data per")} {t(storeLabel)}</h3>
        <div className="hint">{t("Sorted by sales · Baseline excluded · line shows SPOS sales trend")} · {t("Klik baris untuk detail")}</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <th>{t(storeLabel)}</th><th>{t("Trend")}</th>
              <th className="num">{t("Sales")}</th><th className="num">{t("Traffic")}</th>
              <th className="num">{t("In-Cart")}</th><th className="num">{t("Cart Rate")}</th>
              <th className="num">{t("Ads Cost")}</th><th className="num">{t("ROAS Trend")}</th><th className="num">{t("ROAS")}</th>
            </tr></thead>
            <tbody>
              {(d?.dealers||[]).map((r, i) => {
                const cr = r.traffic ? (r.in_cart / r.traffic) * 100 : 0;
                const roasTrend = r.trend?.map((tr) => ({ month: tr.month, value: tr.ad_cost ? tr.sales / tr.ad_cost : 0 }));
                return (
                  <tr key={i} style={{ cursor: "pointer" }} onClick={() => setDrillStore(r)}>
                    <td>{r.store_name}</td>
                    <td><Sparkline data={r.trend?.map((t) => ({ month: t.month, value: t.sales }))} /></td>
                    <td className="num">{idr(r.sales)}</td>
                    <td className="num">{num(r.traffic)}</td>
                    <td className="num">{num(r.in_cart)}</td>
                    <td className="num">{cr.toFixed(1)}%</td>
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
              {(!d?.dealers||d.dealers.length===0) && (
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

function Panel({ title, hint, children }: { title:string; hint:string; children:React.ReactNode }) {
  return (
    <div className="panel">
      <h3 style={{ margin:"0 0 2px" }}>{title}</h3>
      <div className="hint" style={{ marginBottom:14 }}>{hint}</div>
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

// Merge monthly_sales + traffic_trend into one series for the combined chart.
function buildMonthlyPerf(d: Summary | null): { month: string; sales: number; traffic: number; in_cart: number }[] {
  const salesByMonth = new Map((d?.monthly_sales || []).map((x) => [x.month, x.sales]));
  const trafficByMonth = new Map((d?.traffic_trend || []).map((x) => [x.month, x]));
  const months = [...new Set([...salesByMonth.keys(), ...trafficByMonth.keys()])]
    .filter((m) => m?.toLowerCase().trim() !== "baseline");
  return byMonth(months.map((month) => ({ month }))).map(({ month }) => ({
    month,
    sales: salesByMonth.get(month) ?? 0,
    traffic: trafficByMonth.get(month)?.traffic ?? 0,
    in_cart: trafficByMonth.get(month)?.in_cart ?? 0,
  }));
}

/* ── Monthly Performance — Sales as a glowing gold area/line (primary, Rp
     axis) + Traffic and In-Cart as blue lines (secondary, count axis).
     Sales uses ONE <Area> (fill + stroke together) instead of a separate
     Area+Line pair on the same dataKey — that duplicate was showing "Sales"
     twice in the tooltip. ── */
function MonthlySalesChart({ data }: { data: { month: string; sales: number; traffic: number; in_cart: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width:"100%", height:290 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left:4, right:20, top:18, bottom:8 }}>
          <defs>
            <linearGradient id="gMonthlyWave" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.4" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={sm} tick={axis} interval={0} axisLine={false} tickLine={false} height={28} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={58} />
          <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={(v) => num(Number(v))} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={TIP_STYLE}
            cursor={{ stroke: "rgba(201,162,39,0.35)", strokeWidth: 1 }}
            formatter={(v, n) => n === "sales" ? [idrF(Number(v)), "Sales"] : [num(Number(v)), n === "traffic" ? "Traffic" : "In-Cart"]}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10, color: "#9ab0cc" }} formatter={(v) => v === "sales" ? "Sales" : v === "traffic" ? "Traffic" : "In-Cart"} />
          <Area yAxisId="l" type="monotone" dataKey="sales" name="sales" stroke={GOLD} strokeWidth={3} fill="url(#gMonthlyWave)"
            dot={{ r:5, fill:GOLD, stroke:"#0a1628", strokeWidth:2 }}
            activeDot={{ r:7, fill:GOLD_L, stroke:"#0a1628", strokeWidth:2 }}
          />
          <Line yAxisId="r" type="monotone" dataKey="traffic" name="traffic" stroke="#8fc4ff" strokeWidth={2}
            dot={{ r:3, fill:"#8fc4ff" }} activeDot={{ r:5 }} />
          <Line yAxisId="r" type="monotone" dataKey="in_cart" name="in_cart" stroke={BLUE} strokeWidth={2}
            dot={{ r:3, fill:BLUE }} activeDot={{ r:5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Horizontal 3D Bar Chart (top products) ── */
function HBarsChart({ data }: { data: { name:string; sales:number }[] }) {
  if (!data.length) return <Empty />;
  const rows = data.map((p, i) => ({
    ...p,
    label: (i+1)+". "+(p.name.length>46 ? p.name.slice(0,46)+"…" : p.name),
  }));
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <div style={{ width:"100%", height:320 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={rows} barSize={16} margin={{ left:8, right:24, top:4, bottom:4 }} barCategoryGap="18%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} domain={[0, max * 1.12]} />
          <YAxis type="category" dataKey="label" tick={{ fontSize:10, fill:"#9ab0cc" }} width={280} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={TIP_STYLE}
            formatter={(v) => [idrF(Number(v)), "Sales"]}
            cursor={{ fill:"rgba(59,130,246,0.05)" }}
          />
          <Bar dataKey="sales" shape={<HBar3D fill="url(#gNavy)" />} radius={[0,4,4,0]}>
            {rows.map((_, i) => (
              <Cell key={i} fill="url(#gNavy)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Ads Cost vs ROAS composed chart ── */
function CostRoasChart({ data }: { data: { month:string; cost:number; roas:number|null }[] }) {
  if (!data.length) return <Empty />;
  const barW = Math.min(Math.max(Math.floor(500/data.length)-10, 36), 110);
  return (
    <div style={{ width:"100%", height:290 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} barSize={barW} margin={{ left:4, right:20, top:18, bottom:8 }} barCategoryGap="6%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={sm} tick={axis} interval={0} axisLine={false} tickLine={false} height={28} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={58} />
          <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={30} />
          <Tooltip
            contentStyle={TIP_STYLE}
            formatter={(v, n) => n === "roas"
              ? [(Number(v)||0).toFixed(2)+"×", "ROAS"]
              : [idrF(Number(v)), "Ads Cost"]
            }
            labelFormatter={(l) => l}
          />
          <Bar yAxisId="l" dataKey="cost" shape={<Bar3D fill="url(#gNavy)" />} radius={[4,4,0,0]}>
            {data.map((_, i) => <Cell key={i} fill="url(#gNavy)" />)}
          </Bar>
          <Line
            yAxisId="r" type="monotone" dataKey="roas"
            stroke={GOLD} strokeWidth={2.5}
            dot={{ r:4, fill:GOLD, stroke:"#0a1628", strokeWidth:2 }}
            activeDot={{ r:6, fill:GOLD_L, stroke:"#0a1628", strokeWidth:2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Sales per Store bar chart ── */
function StoreSalesChart({ data }: { data: { store_name: string; sales: number }[] }) {
  if (!data.length) return <Empty />;
  const rows = [...data].sort((a, b) => b.sales - a.sales);
  const barW = Math.min(Math.max(Math.floor(560 / rows.length) - 10, 32), 120);
  return (
    <div style={{ width: "100%", height: 290 }}>
      <ResponsiveContainer>
        <BarChart data={rows} barSize={barW} margin={{ left: 4, right: 20, top: 18, bottom: 28 }} barCategoryGap="6%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="store_name"
            tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + "…" : v}
            tick={axis} interval={0} axisLine={false} tickLine={false} height={70}
            angle={-45} textAnchor="end"
          />
          <YAxis tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip
            contentStyle={TIP_STYLE}
            cursor={{ fill: "rgba(201,162,39,0.04)" }}
            formatter={(v) => [idrF(Number(v)), "Sales"]}
            labelFormatter={(l) => `🏪 ${l}`}
          />
          <Bar dataKey="sales" shape={<Bar3D fill="url(#gNavy)" />} radius={[4, 4, 0, 0]}>
            {rows.map((_, i) => <Cell key={i} fill="url(#gNavy)" />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Traffic vs In-Cart area chart ── */
function TrafficChart({ data }: { data: { month:string; traffic:number; in_cart:number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width:"100%", height:290 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left:4, right:20, top:18, bottom:8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tickFormatter={sm} tick={axis} interval={0} axisLine={false} tickLine={false} height={28} />
          <YAxis tick={axis} tickFormatter={(v) => num(Number(v))} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            contentStyle={TIP_STYLE}
            formatter={(v, n) => [num(Number(v)), n==="in_cart"?"In-Cart":"Traffic"]}
            labelFormatter={(l) => l}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:10, color:"#9ab0cc", paddingTop:4 }} />
          <Area type="monotone" dataKey="traffic"
            stroke="#94a3b8" strokeWidth={2.5} fill="url(#gTraffic)"
            dot={{ r:4, fill:"#94a3b8", stroke:"#0a1628", strokeWidth:2 }}
            activeDot={{ r:6 }}
          />
          <Area type="monotone" dataKey="in_cart"
            stroke={BLUE_L} strokeWidth={2.5} fill="url(#gCart)"
            dot={{ r:4, fill:BLUE_L, stroke:"#0a1628", strokeWidth:2 }}
            activeDot={{ r:6 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
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
function FunnelChart({ traffic, inCart, orders, t }: { traffic: number; inCart: number; orders: number; t: (k: string) => string }) {
  if (!traffic) return <Empty />;
  const stages = [
    { label: t("Traffic"), value: traffic },
    { label: t("In-Cart"), value: inCart },
    { label: t("Sales") + " (pc)", value: orders },
  ];
  const W = 240, H = 260;
  const segH = H / stages.length;
  const minW = W * 0.26;
  const max = stages[0].value || 1;
  const widths = stages.map((s) => minW + (W - minW) * Math.max(s.value / max, 0.1));
  for (let i = 1; i < widths.length; i++) widths[i] = Math.min(widths[i], widths[i - 1] - 10);

  return (
    <div style={{ display: "flex", gap: 22, alignItems: "center", padding: "6px 4px" }}>
      <svg width={W} height={H} style={{ flexShrink: 0, overflow: "visible" }}>
        <defs>
          {/* One continuous gradient sweep spanning the full funnel — gold (top,
              broad reach) flowing into blue (bottom, the narrower converted
              slice) — our own identity, not a disjoint per-segment palette. */}
          <linearGradient id="funnel-sweep" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={GOLD_L} />
            <stop offset="50%" stopColor={GOLD} />
            <stop offset="100%" stopColor={BLUE} />
          </linearGradient>
        </defs>
        {stages.map((s, i) => {
          const y = i * segH;
          const wTop = widths[i], wBot = widths[i + 1] ?? widths[i] * 0.62;
          const xTop = (W - wTop) / 2, xBot = (W - wBot) / 2;
          const gap = 4;
          const pts = `${xTop},${y} ${xTop + wTop},${y} ${xBot + wBot},${y + segH - gap} ${xBot},${y + segH - gap}`;
          const prevPct = i > 0 && stages[i - 1].value ? (s.value / stages[i - 1].value) * 100 : 100;
          return (
            <g key={i}>
              <polygon points={pts} fill="url(#funnel-sweep)" style={{ filter: "drop-shadow(0 0 10px rgba(201,162,39,0.4))" }} />
              <text x={W / 2} y={y + segH / 2 - gap / 2 + 5} textAnchor="middle" fontSize="15" fontWeight={800} fill="#0a1628">
                {prevPct.toFixed(0)}%
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        {stages.map((s, i) => {
          const prevPct = i > 0 && stages[i - 1].value ? (s.value / stages[i - 1].value) * 100 : null;
          return (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>{s.label}</span>
              <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{num(s.value)}</span>
                {prevPct != null && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: GOLD }}>{prevPct.toFixed(0)}%</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Best Campaign Performance: horizontal bars ranked by sales, views annotated ── */
function CampaignChart({ data }: { data: { name: string; views: number; orders: number; sales: number; ad_cost: number }[] }) {
  if (!data.length) return <Empty />;
  const rows = data.map((c, i) => ({
    ...c,
    label: (i + 1) + ". " + (c.name.length > 30 ? c.name.slice(0, 30) + "…" : c.name),
  }));
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={rows} barSize={16} margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap="18%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} domain={[0, max * 1.12]} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "#9ab0cc" }} width={190} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={TIP_STYLE}
            formatter={(v, n) => n === "sales" ? [idrF(Number(v)), "Penjualan"] : [num(Number(v)), "Dilihat"]}
            cursor={{ fill: "rgba(59,130,246,0.04)" }}
          />
          <Bar dataKey="sales" shape={<HBar3D fill="url(#gNavy)" />} radius={[0, 4, 4, 0]}>
            {rows.map((_, i) => <Cell key={i} fill={i === 0 ? "url(#gGold)" : "url(#gNavy)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Store drill-down — first pass: KPI grid + sales/ad-cost trend for the clicked store ── */
function StoreDrillDown({ store, storeLabel, t, onClose }: {
  store: { store_name: string; city: string; sales: number; traffic: number; in_cart: number; orders: number; ad_cost: number; roas: number | null; trend?: { month: string; sales: number; ad_cost: number | null }[] };
  storeLabel: string; t: (k: string) => string; onClose: () => void;
}) {
  const cr = store.traffic ? (store.in_cart / store.traffic) * 100 : 0;
  const trend = byMonth(store.trend || []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" }} onClick={onClose}>
      <div style={{ width: "min(96vw,900px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 26, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{store.store_name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{store.city} · {t(storeLabel)}</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>

        <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3,1fr)", marginBottom: 18 }}>
          <div className="kpi kpi-hero"><div className="lbl">{t("Sales")}</div><div className="val">{idr(store.sales)}</div></div>
          <div className="kpi"><div className="lbl">{t("Traffic")}</div><div className="val">{num(store.traffic)}</div></div>
          <div className="kpi"><div className="lbl">{t("In-Cart")}</div><div className="val">{num(store.in_cart)}</div><div className="kpi-sub">{cr.toFixed(1)}% {t("cart rate")}</div></div>
          <div className="kpi"><div className="lbl">Orders</div><div className="val">{num(store.orders)}</div></div>
          <div className="kpi"><div className="lbl">{t("Ads Cost")}</div><div className="val">{idr(store.ad_cost)}</div></div>
          <div className="kpi kpi-roas"><div className="lbl">{t("ROAS")}</div><div className="val">{store.roas ? store.roas.toFixed(2) + "×" : "—"}</div></div>
        </div>

        <div className="hint" style={{ marginBottom: 8 }}>{t("Monthly Sales")} vs {t("ROAS")}</div>
        {trend.length ? (() => {
          const trendRoas = trend.map((row) => ({ ...row, roas: row.ad_cost ? row.sales / row.ad_cost : null }));
          return (
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart data={trendRoas} margin={{ left: 4, right: 20, top: 10, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={sm} tick={axis} interval={0} axisLine={false} tickLine={false} height={28} />
                <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={58} />
                {/* right axis auto-fits tight to the ROAS data range (not forced to start at 0),
                    so the line floats mid-chart and fluctuations read clearly instead of looking flat */}
                <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={(v) => Number(v).toFixed(1)+"×"}
                  axisLine={false} tickLine={false} width={40}
                  domain={[(min: number) => Math.max(0, min * 0.8), (max: number) => max * 1.15]} />
                <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => n === "sales" ? [idrF(Number(v)), "Sales"] : [Number(v).toFixed(2)+"×", "ROAS"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10, color: "#9ab0cc" }} />
                <Bar yAxisId="l" dataKey="sales" fill="url(#gNavy)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="roas" stroke={GOLD} strokeWidth={2.5}
                  dot={{ r: 4, fill: GOLD, stroke: "#0a1628", strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: GOLD_L, stroke: "#0a1628", strokeWidth: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          );
        })() : <Empty />}
      </div>
    </div>
  );
}
