"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, LineChart, PieChart, Pie, Cell, Legend,
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

const MONTH_ORDER = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const byMonth = <T extends { month: string }>(a: T[]) =>
  [...(a || [])].sort((x, y) => MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month));

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
const PALETTE = ["#c9a227", "#e8c84a", "#94a3b8", "#1e4a7a", "#3b6ea5", "#d4b94e", "#6b8cae", "#0f2040"];

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [storeLabel, setStoreLabel] = useState("Store");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], cities: [], stores: [] });
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "" });
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
      const { data: f } = await supabase.rpc("dashboard_filters");
      if (f) setFilters(f as Filters);
    })();
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("dashboard_summary", {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city: sel.city || null,
      p_store: sel.store || null,
    });
    setD(data as Summary);
    setLoading(false);
  }, [supabase, sel]);
  useEffect(() => { load(); }, [load]);

  const k = d?.kpis;
  const roasPct = k?.roas ? Math.min((k.roas / 5) * 100, 100) : 0;
  const cartRate = k && k.traffic ? (k.in_cart / k.traffic) * 100 : 0;

  return (
    <>
      {/* Filters */}
      <div className="filterbar">
        <Sel label="Year" value={sel.year} onChange={(v) => setSel({ ...sel, year: v })} opts={filters.years.map(String)} all="All Years" />
        <Sel label="Month" value={sel.month} onChange={(v) => setSel({ ...sel, month: v })} opts={filters.months} all="All Months" />
        <Sel label="City" value={sel.city} onChange={(v) => setSel({ ...sel, city: v })} opts={filters.cities} all="All Cities" />
        <Sel label={storeLabel} value={sel.store} onChange={(v) => setSel({ ...sel, store: v })} opts={filters.stores} all={`All ${storeLabel}s`} />
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", city: "", store: "" })}>Reset</button>
        {loading && <span style={{ alignSelf: "center", color: "var(--gold)", fontSize: 12 }}>Updating…</span>}
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">Total Sales</div><div className="val">{k ? idr(k.sales) : "—"}</div><div className="kpi-sub">SPOS · siap dikirim</div></div>
        <div className="kpi"><div className="kpi-icon">🏪</div><div className="lbl">Total GMV</div><div className="val">{k ? idr(k.gmv) : "—"}</div><div className="kpi-sub">Performa</div></div>
        <div className="kpi"><div className="kpi-icon">👁</div><div className="lbl">Traffic</div><div className="val">{k ? num(k.traffic) : "—"}</div></div>
        <div className="kpi"><div className="kpi-icon">🛒</div><div className="lbl">In-Cart</div><div className="val">{k ? num(k.in_cart) : "—"}</div><div className="kpi-sub">{k ? cartRate.toFixed(1) + "% cart rate" : ""}</div></div>
        <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">Ads Cost</div><div className="val">{k ? idr(k.ad_cost) : "—"}</div></div>
        <div className="kpi kpi-roas"><div className="kpi-icon">⚡</div><div className="lbl">ROAS</div><div className="val">{k && k.roas ? k.roas.toFixed(2) + "×" : "—"}</div><div className="roas-bar"><div className="roas-fill" style={{ width: roasPct + "%" }} /></div></div>
      </div>

      {/* Monthly sales */}
      <div className="row">
        <Panel title="Monthly Sales" hint="Penjualan per bulan · SPOS">
          <BarsChart data={byMonth(d?.monthly_sales || [])} x="month" y="sales" color="#c9a227" />
        </Panel>
      </div>

      {/* Top products + brand share */}
      <div className="row c2">
        <Panel title={`Top 10 Best-Selling Products`} hint="Sales · parent rows only">
          <HBarChart data={d?.top_products || []} />
        </Panel>
        <Panel title="Brand Share of Sales" hint="Sales mix by brand · SPOS">
          <Donut data={(d?.brand_share || []).map((b) => ({ name: b.brand, value: b.sales }))} />
        </Panel>
      </div>

      {/* Cost vs ROAS + traffic trend */}
      <div className="row c2b">
        <Panel title="Monthly Ads Cost vs ROAS" hint="Columns = cost · line = ROAS">
          <CostRoas data={byMonth(d?.cost_roas || [])} />
        </Panel>
        <Panel title="Traffic vs Add-to-Cart" hint="Funnel trend per month">
          <TrafficTrend data={byMonth(d?.traffic_trend || [])} />
        </Panel>
      </div>

      {/* Store monthly */}
      <div className="row">
        <Panel title="Store Sales by Month" hint="All brands GMV · Performa">
          <BarsChart data={byMonth(d?.store_monthly || [])} x="month" y="gmv" color="#1e4a7a" />
        </Panel>
      </div>

      {/* Category + category share */}
      <div className="row c2">
        <Panel title="Sales by Category" hint="SPOS · product type">
          <BarsChart data={d?.by_category || []} x="category" y="sales" color="#e8c84a" />
        </Panel>
        <Panel title="Category Share (%)" hint="Sales mix by category">
          <Donut data={(d?.by_category || []).map((c) => ({ name: c.category, value: c.sales }))} />
        </Panel>
      </div>

      {/* Dealer table */}
      <div className="panel">
        <h3>Detail Data per {storeLabel}</h3>
        <div className="hint">Sorted by sales</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <th>{storeLabel}</th><th>City</th><th className="num">Sales</th><th className="num">Traffic</th>
              <th className="num">In-Cart</th><th className="num">Cart Rate</th><th className="num">Ads Cost</th><th className="num">ROAS</th>
            </tr></thead>
            <tbody>
              {(d?.dealers || []).map((r, i) => {
                const cr = r.traffic ? (r.in_cart / r.traffic) * 100 : 0;
                return (
                  <tr key={i}>
                    <td>{r.store_name}</td><td>{r.city || "—"}</td>
                    <td className="num">{idr(r.sales)}</td>
                    <td className="num">{num(r.traffic)}</td>
                    <td className="num">{num(r.in_cart)}</td>
                    <td className="num">{cr.toFixed(1)}%</td>
                    <td className="num">{idr(r.ad_cost)}</td>
                    <td className="num"><span className={`pill ${!r.roas ? "" : r.roas >= 3 ? "good" : r.roas >= 1 ? "warn" : "bad"}`}>{r.roas ? r.roas.toFixed(2) + "×" : "—"}</span></td>
                  </tr>
                );
              })}
              {(!d?.dealers || d.dealers.length === 0) && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------- building blocks ---------- */
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
function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <div className="panel"><h3>{title}</h3><div className="hint">{hint}</div>{children}</div>;
}
function Empty() { return <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>; }

const tooltip = { background: "#0f2040", border: "1px solid rgba(201,162,39,.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 };
const axis = { fontSize: 10, fill: "#94a3b8" };

function BarsChart({ data, x, y, color }: { data: Record<string, unknown>[]; x: string; y: string; color: string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey={x} tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={52} />
          <Tooltip contentStyle={tooltip} formatter={(v) => [idr(Number(v)), "Sales"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar dataKey={y} fill={color} radius={[4, 4, 0, 0]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function HBarChart({ data }: { data: { name: string; sales: number }[] }) {
  if (!data.length) return <Empty />;
  const short = data.map((p) => ({ ...p, label: p.name.length > 26 ? p.name.slice(0, 26) + "…" : p.name }));
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={short} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "#bcd0ee" }} width={150} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltip} formatter={(v) => [idr(Number(v)), "Sales"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar dataKey="sales" fill="#c9a227" radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Donut({ data }: { data: { name: string; value: number }[] }) {
  const filtered = data.filter((x) => x.value > 0);
  if (!filtered.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={filtered} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {filtered.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="#0a1628" strokeWidth={2} />)}
          </Pie>
          <Tooltip contentStyle={tooltip} formatter={(v) => idr(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 11, color: "#bcd0ee" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostRoas({ data }: { data: { month: string; cost: number; roas: number | null }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="month" tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis yAxisId="l" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={52} />
          <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={32} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => n === "roas" ? [(Number(v) || 0).toFixed(2) + "×", "ROAS"] : [idr(Number(v)), "Cost"]} cursor={{ fill: "rgba(201,162,39,.05)" }} />
          <Bar yAxisId="l" dataKey="cost" fill="#1e4a7a" radius={[4, 4, 0, 0]} maxBarSize={40} />
          <Line yAxisId="r" type="monotone" dataKey="roas" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3, fill: "#c9a227" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrafficTrend({ data }: { data: { month: string; traffic: number; in_cart: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.05)" vertical={false} />
          <XAxis dataKey="month" tick={axis} interval={0} angle={-25} textAnchor="end" height={50} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => num(Number(v))} axisLine={false} tickLine={false} width={48} />
          <Tooltip contentStyle={tooltip} formatter={(v, n) => [num(Number(v)), n === "in_cart" ? "In-Cart" : "Traffic"]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="traffic" stroke="#94a3b8" strokeWidth={2.5} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="in_cart" stroke="#c9a227" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
