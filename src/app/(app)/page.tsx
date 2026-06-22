"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Summary = {
  kpis: { sales: number; orders: number; units: number; visitors: number; ad_cost: number; gmv: number };
  by_brand: { brand: string; sales: number }[];
  by_store: { store_name: string; sales: number }[];
  by_month: { month: string; sales: number }[];
  by_city: { city: string; sales: number }[];
};
type Filters = { years: number[]; months: string[]; cities: string[]; stores: string[] };

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(n || 0);

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [storeLabel, setStoreLabel] = useState("Store");
  const [filters, setFilters] = useState<Filters>({ years: [], months: [], cities: [], stores: [] });
  const [sel, setSel] = useState({ year: "", month: "", city: "", store: "" });
  const [data, setData] = useState<Summary | null>(null);
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
    const { data: d } = await supabase.rpc("dashboard_summary", {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_city: sel.city || null,
      p_store: sel.store || null,
    });
    setData(d as Summary);
    setLoading(false);
  }, [supabase, sel]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpis;
  const kpis = [
    { cls: "kpi kpi-hero", icon: "💰", lbl: "Total Sales", val: k ? "Rp " + idr(k.sales) : "—" },
    { cls: "kpi", icon: "🏪", lbl: "GMV", val: k ? "Rp " + idr(k.gmv) : "—" },
    { cls: "kpi", icon: "👁", lbl: "Visitors", val: k ? num(k.visitors) : "—" },
    { cls: "kpi", icon: "🛒", lbl: "Orders", val: k ? num(k.orders) : "—" },
    { cls: "kpi", icon: "📦", lbl: "Units Sold", val: k ? num(k.units) : "—" },
    { cls: "kpi kpi-roas", icon: "📣", lbl: "Ad Spend", val: k ? "Rp " + idr(k.ad_cost) : "—" },
  ];

  return (
    <>
      <div className="filterbar">
        <div className="fld"><label>Year</label>
          <select value={sel.year} onChange={(e) => setSel({ ...sel, year: e.target.value })}>
            <option value="">All Years</option>
            {filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select></div>
        <div className="fld"><label>Month</label>
          <select value={sel.month} onChange={(e) => setSel({ ...sel, month: e.target.value })}>
            <option value="">All Months</option>
            {filters.months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
        <div className="fld"><label>City</label>
          <select value={sel.city} onChange={(e) => setSel({ ...sel, city: e.target.value })}>
            <option value="">All Cities</option>
            {filters.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div className="fld"><label>{storeLabel}</label>
          <select value={sel.store} onChange={(e) => setSel({ ...sel, store: e.target.value })}>
            <option value="">All {storeLabel}s</option>
            {filters.stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", city: "", store: "" })}>Reset</button>
        {loading && <span style={{ alignSelf: "center", color: "var(--gold)", fontSize: 12 }}>Updating…</span>}
      </div>

      <div className="kpi-grid">
        {kpis.map((c) => (
          <div key={c.lbl} className={c.cls}>
            <div className="kpi-icon">{c.icon}</div>
            <div className="lbl">{c.lbl}</div>
            <div className="val">{c.val}</div>
          </div>
        ))}
      </div>

      <div className="row c2">
        <Chart title="Sales by Brand" hint="Panasonic vs others" data={data?.by_brand} xKey="brand" color="#c9a227" />
        <Chart title={`Sales by ${storeLabel}`} hint="Top stores by sales" data={data?.by_store} xKey="store_name" color="#e8c84a" />
      </div>
      <div className="row c2b">
        <Chart title="Sales by Month" hint="Monthly trend" data={data?.by_month} xKey="month" color="#c9a227" />
        <Chart title="Sales by City" hint="Geographic split" data={data?.by_city} xKey="city" color="#94a3b8" />
      </div>
    </>
  );
}

function Chart({
  title, hint, data, xKey, color,
}: { title: string; hint: string; data?: Record<string, unknown>[]; xKey: string; color: string }) {
  const empty = !data || data.length === 0;
  return (
    <div className="panel">
      <h3>{title}</h3>
      <div className="hint">{hint}</div>
      {empty ? (
        <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>
          No data yet
        </div>
      ) : (
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: "#94a3b8" }} interval={0} angle={-30} textAnchor="end" height={50} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={48} />
              <Tooltip
                contentStyle={{ background: "#0f2040", border: "1px solid rgba(201,162,39,0.3)", borderRadius: 8, color: "#e8edf8", fontSize: 12 }}
                formatter={(v) => ["Rp " + num(Number(v)), "Sales"]}
                cursor={{ fill: "rgba(201,162,39,0.05)" }}
              />
              <Bar dataKey="sales" fill={color} radius={[4, 4, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
