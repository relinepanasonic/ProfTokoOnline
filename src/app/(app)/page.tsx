"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Summary = {
  kpis: { sales: number; gmv: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null };
  monthly_sales: { month: string; sales: number }[];
  store_monthly: { month: string; gmv: number }[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  by_category: { category: string; sales: number }[];
  cost_roas: { month: string; cost: number; roas: number | null }[];
  traffic_trend: { month: string; traffic: number; in_cart: number }[];
  dealers: { store_name: string; city: string; sales: number; traffic: number; in_cart: number; ad_cost: number; roas: number | null }[];
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
const NAVY   = "#1e4a7a";
const NAVY_L = "#3b82c4";
const PALETTE = ["#c9a227","#e8c84a","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#14b8a6"];

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
        {/* Yellow bar gradient */}
        <linearGradient id="gYellow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#92611a" />
        </linearGradient>
        {/* Traffic area gradient */}
        <linearGradient id="gTraffic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#94a3b8" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.02" />
        </linearGradient>
        {/* In-cart area gradient */}
        <linearGradient id="gCart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={GOLD} stopOpacity="0.7" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0.02" />
        </linearGradient>
        {/* Cost area gradient */}
        <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={NAVY_L} stopOpacity="0.65" />
          <stop offset="100%" stopColor={NAVY_L} stopOpacity="0.02" />
        </linearGradient>
        {/* Glow filter */}
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
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
  if (!h || h < 1 || !w || w < 1) return null;

  const d  = Math.min(w * 0.22, 11);   // horizontal depth
  const dv = d * 0.52;                  // vertical depth (perspective angle)
  const rx = 2;

  return (
    <g filter="url(#glow)">
      {/* front face */}
      <rect x={x} y={y} width={w} height={h} fill={fill} rx={rx} />
      {/* top face */}
      <path
        d={`M${x},${y} L${x+d},${y-dv} L${x+w+d},${y-dv} L${x+w},${y} Z`}
        fill="rgba(255,255,255,0.28)"
      />
      {/* right side face */}
      <path
        d={`M${x+w},${y} L${x+w+d},${y-dv} L${x+w+d},${y+h-dv} L${x+w},${y+h} Z`}
        fill="rgba(0,0,0,0.38)"
      />
      {/* top edge highlight */}
      <line x1={x} y1={y} x2={x+w} y2={y} stroke="rgba(255,255,255,0.45)" strokeWidth={1} />
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
  const [supabase] = useState(() => createClient());
  const [storeLabel, setStoreLabel] = useState("Store");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], cities: [], stores: [] });
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "", owner: "", brand: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("client_id").eq("id", user.id).single();
      if (p?.client_id) {
        const { data: c } = await supabase.from("clients").select("store_label").eq("id", p.client_id).single();
        if (c?.store_label) setStoreLabel(c.store_label);
      }
      const [{ data: f }, { data: sl }] = await Promise.all([
        supabase.rpc("dashboard_filters"),
        supabase.from("store_links").select("owner,brand,store_name").order("owner"),
      ]);
      if (f) setFilters(f as Filters);
      setLinks((sl as StoreLink[]) || []);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("dashboard_summary", {
      p_year:  sel.year  ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city:  sel.city  || null,
      p_owner: sel.owner || null,
      p_brand: sel.brand || null,
      p_store: sel.store || null,
    });
    setD(data as Summary);
    setLoading(false);
  }, [supabase, sel]);
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

  return (
    <>
      <ChartDefs />

      {/* ── Filters ── */}
      <div className="filterbar">
        <Sel label="Year"  value={sel.year}  onChange={(v) => setSel((s) => ({ ...s, year: v }))}  opts={filters.years.map(String)} all="All Years" />
        <Sel label="Month" value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={filters.months} all="All Months" />
        <Sel label="City"  value={sel.city}  onChange={(v) => setSel((s) => ({ ...s, city: v }))}  opts={filters.cities} all="All Cities" />
        {owners.length > 0 && <Sel label="Owner" value={sel.owner} onChange={pickOwner} opts={owners} all="All Owners" />}
        {brandsForOwner.length > 0 && <Sel label="Brand" value={sel.brand} onChange={pickBrand} opts={brandsForOwner} all="All Brands" />}
        <Sel label={storeLabel} value={sel.store} onChange={pickStore} opts={filteredStores} all={`All ${storeLabel}s`} />
        <button className="btn-ghost" onClick={() => setSel({ year:"", month:"", city:"", store:"", owner:"", brand:"" })}>Reset</button>
        {loading && <span style={{ alignSelf:"center", color: GOLD, fontSize:12 }}>Updating…</span>}
      </div>

      {/* ── KPIs ── */}
      <div className="kpi-grid">
        <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">Total Sales</div><div className="val">{k ? idr(k.sales) : "—"}</div><div className="kpi-sub">SPOS · siap dikirim</div></div>
        <div className="kpi"><div className="kpi-icon">🏪</div><div className="lbl">Total GMV</div><div className="val">{k ? idr(k.gmv) : "—"}</div><div className="kpi-sub">Performa</div></div>
        <div className="kpi"><div className="kpi-icon">👁</div><div className="lbl">Traffic</div><div className="val">{k ? num(k.traffic) : "—"}</div></div>
        <div className="kpi"><div className="kpi-icon">🛒</div><div className="lbl">In-Cart</div><div className="val">{k ? num(k.in_cart) : "—"}</div><div className="kpi-sub">{k ? cartRate.toFixed(1)+"% cart rate" : ""}</div></div>
        <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">Ads Cost</div><div className="val">{k ? idr(k.ad_cost) : "—"}</div></div>
        <div className="kpi kpi-roas"><div className="kpi-icon">⚡</div><div className="lbl">ROAS</div><div className="val">{k && k.roas ? k.roas.toFixed(2)+"×" : "—"}</div><div className="roas-bar"><div className="roas-fill" style={{ width: roasPct+"%" }} /></div></div>
      </div>

      {/* ── Monthly sales ── */}
      <div className="row">
        <Panel title="Monthly Sales" hint="Penjualan per bulan · SPOS">
          <Bars3DChart data={byMonth((d?.monthly_sales||[]).filter(m=>m.month?.toLowerCase().trim()!=="baseline"))} x="month" y="sales" grad="url(#gGold)" accent={GOLD} />
        </Panel>
      </div>

      {/* ── Top products + brand share ── */}
      <div className="row c2">
        <Panel title="Top 10 Best-Selling Products" hint="Sales · SPOS parent rows">
          <HBarsChart data={d?.top_products||[]} />
        </Panel>
        <Panel title="Brand Share of Sales" hint="Sales mix by brand · SPOS">
          <DonutChart data={(d?.brand_share||[]).map((b) => ({ name: b.brand, value: b.sales }))} />
        </Panel>
      </div>

      {/* ── Cost vs ROAS + traffic ── */}
      <div className="row c2b">
        <Panel title="Monthly Ads Cost vs ROAS" hint="Bars = cost · line = ROAS">
          <CostRoasChart data={byMonth((d?.cost_roas||[]).filter(m=>m.month?.toLowerCase().trim()!=="baseline"))} />
        </Panel>
        <Panel title="Traffic vs Add-to-Cart" hint="Funnel trend per month">
          <TrafficChart data={byMonth((d?.traffic_trend||[]).filter(m=>m.month?.toLowerCase().trim()!=="baseline"))} />
        </Panel>
      </div>

      {/* ── Sales per Store ── */}
      <div className="row">
        <Panel title="Sales per Store" hint="Total SPOS sales per store · baseline excluded">
          <StoreSalesChart data={d?.dealers||[]} />
        </Panel>
      </div>

      {/* ── Dealer table ── */}
      <div className="panel">
        <h3>Detail Data per {storeLabel}</h3>
        <div className="hint">Sorted by sales · Baseline excluded</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <th>{storeLabel}</th><th>City</th>
              <th className="num">Sales</th><th className="num">Traffic</th>
              <th className="num">In-Cart</th><th className="num">Cart Rate</th>
              <th className="num">Ads Cost</th><th className="num">ROAS</th>
            </tr></thead>
            <tbody>
              {(d?.dealers||[]).map((r, i) => {
                const cr = r.traffic ? (r.in_cart / r.traffic) * 100 : 0;
                return (
                  <tr key={i}>
                    <td>{r.store_name}</td><td>{r.city||"—"}</td>
                    <td className="num">{idr(r.sales)}</td>
                    <td className="num">{num(r.traffic)}</td>
                    <td className="num">{num(r.in_cart)}</td>
                    <td className="num">{cr.toFixed(1)}%</td>
                    <td className="num">{idr(r.ad_cost)}</td>
                    <td className="num">
                      <span className={`pill ${!r.roas?"":r.roas>=3?"good":r.roas>=1?"warn":"bad"}`}>
                        {r.roas ? r.roas.toFixed(2)+"×" : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {(!d?.dealers||d.dealers.length===0) && (
                <tr><td colSpan={8} style={{ textAlign:"center", color:"var(--muted)", padding:20 }}>No data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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

/* ── 3D Bar Chart (vertical) ── */
function Bars3DChart({ data, x, y, grad, accent, short: shortLabel }:
  { data: Record<string, unknown>[]; x:string; y:string; grad:string; accent:string; short?: boolean }) {
  if (!data.length) return <Empty />;
  const barW = Math.min(Math.max(Math.floor(620 / data.length) - 10, 40), 130);
  return (
    <div style={{ width:"100%", height:290 }}>
      <ResponsiveContainer>
        <BarChart data={data} barSize={barW} margin={{ left:4, right:20, top:18, bottom:8 }} barCategoryGap="6%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey={x}
            tickFormatter={shortLabel ? (v:string) => v.length>7?v.slice(0,7)+"…":v : sm}
            tick={axis} interval={0} axisLine={false} tickLine={false}
            height={28}
          />
          <YAxis tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip
            contentStyle={TIP_STYLE}
            cursor={{ fill:"rgba(201,162,39,0.04)" }}
            formatter={(v) => [idrF(Number(v)), y === "gmv" ? "GMV" : "Sales"]}
            labelFormatter={(l) => `📅 ${l}`}
          />
          <Bar dataKey={y} fill={grad} shape={<Bar3D fill={grad} />} radius={[4,4,0,0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={grad} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Horizontal 3D Bar Chart (top products) ── */
function HBarsChart({ data }: { data: { name:string; sales:number }[] }) {
  if (!data.length) return <Empty />;
  const rows = data.map((p, i) => ({
    ...p,
    label: (i+1)+". "+(p.name.length>28 ? p.name.slice(0,28)+"…" : p.name),
  }));
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <div style={{ width:"100%", height:320 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={rows} barSize={16} margin={{ left:8, right:24, top:4, bottom:4 }} barCategoryGap="18%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} domain={[0, max * 1.12]} />
          <YAxis type="category" dataKey="label" tick={{ fontSize:10, fill:"#9ab0cc" }} width={170} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={TIP_STYLE}
            formatter={(v) => [idrF(Number(v)), "Sales"]}
            cursor={{ fill:"rgba(201,162,39,0.04)" }}
          />
          <Bar dataKey="sales" shape={<HBar3D fill="url(#gGold)" />} radius={[0,4,4,0]}>
            {rows.map((_, i) => (
              <Cell key={i} fill={i===0?"url(#gGold)":i<3?"url(#gYellow)":"url(#gNavy)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Donut Chart with center total ── */
function DonutChart({ data }: { data: { name:string; value:number }[] }) {
  const filtered = data.filter((x) => x.value > 0);
  if (!filtered.length) return <Empty />;
  const total = filtered.reduce((s, x) => s + x.value, 0);
  return (
    <div style={{ width:"100%", height:300, position:"relative" }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={filtered} dataKey="value" nameKey="name"
            cx="50%" cy="50%" innerRadius={68} outerRadius={105}
            paddingAngle={2} strokeWidth={0}
            label={({ percent }) => percent ? `${(percent*100).toFixed(0)}%` : ""}
            labelLine={false}
          >
            {filtered.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="rgba(6,14,33,0.6)" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TIP_STYLE}
            formatter={(v) => [idrF(Number(v)), "Sales"]}
          />
          <Legend
            iconType="circle" iconSize={8}
            wrapperStyle={{ fontSize:10, color:"#9ab0cc", paddingTop:8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Centre label */}
      <div style={{
        position:"absolute", top:"50%", left:"50%",
        transform:"translate(-50%,-60%)",
        textAlign:"center", pointerEvents:"none",
      }}>
        <div style={{ fontSize:10, color:"#7089aa", marginBottom:2 }}>TOTAL</div>
        <div style={{ fontSize:13, fontWeight:700, color:GOLD }}>{idr(total)}</div>
      </div>
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
            labelFormatter={(l) => `📅 ${l}`}
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
        <BarChart data={rows} barSize={barW} margin={{ left: 4, right: 20, top: 18, bottom: 8 }} barCategoryGap="6%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="store_name"
            tickFormatter={(v: string) => v.length > 12 ? v.slice(0, 12) + "…" : v}
            tick={axis} interval={0} axisLine={false} tickLine={false} height={28}
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
            labelFormatter={(l) => `📅 ${l}`}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:10, color:"#9ab0cc", paddingTop:4 }} />
          <Area type="monotone" dataKey="traffic"
            stroke="#94a3b8" strokeWidth={2.5} fill="url(#gTraffic)"
            dot={{ r:4, fill:"#94a3b8", stroke:"#0a1628", strokeWidth:2 }}
            activeDot={{ r:6 }}
          />
          <Area type="monotone" dataKey="in_cart"
            stroke={GOLD} strokeWidth={2.5} fill="url(#gCart)"
            dot={{ r:4, fill:GOLD, stroke:"#0a1628", strokeWidth:2 }}
            activeDot={{ r:6 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
