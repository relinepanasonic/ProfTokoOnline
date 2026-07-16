"use client";

// Ads Performance overview — Total Ads as 7 individual KPI cards (matching
// the main Dashboard's .kpi-grid/.kpi/.kpi-hero/.kpi-roas markup exactly),
// 3 category cards (GMV Max / Group Ads / Independent Ads), 3 charts, and
// the unified per-product table. Colors are restricted to the app's own
// gold/blue palette (same constants as DashboardCharts.tsx) — no green/
// purple/teal/pink. recharts only loads here, split via next/dynamic in
// page.tsx — same convention as the main Dashboard's DashboardCharts.tsx.
import { useEffect, useState } from "react";
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

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

// Brand palette only — same constants as DashboardCharts.tsx.
const GOLD = "#c9a227", GOLD_L = "#f0d870", BLUE = "#3b82f6", BLUE_L = "#60a5fa";

const TIP_STYLE: React.CSSProperties = {
  background: "rgba(6,14,33,0.97)", border: "1px solid rgba(201,162,39,0.35)", borderRadius: 10,
  color: "#e8edf8", fontSize: 12, padding: "8px 14px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
};
const axis = { fontSize: 10, fill: "#7089aa" };

type Totals = { ads_cost: number; omzet: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type MonthRow = { month: string; gmv_max_omzet: number; group_omzet: number; independent_omzet: number; roas: number | null };
type ViewClickRow = { month: string; view: number; click: number };
type SoldOmzetRow = { month: string; item_sold: number; omzet: number };
type ProductRow = { kode_produk: string; nama_produk: string | null; ads_cost: number; omzet: number; roas: number | null; view: number; click: number; orders: number; item_sold: number };
type Summary = {
  totals: { total: Totals; gmv_max: Totals; group_ads: Totals; independent: Totals };
  monthly: MonthRow[]; view_click_trend: ViewClickRow[]; sold_omzet_trend: SoldOmzetRow[];
  products: ProductRow[];
};

export default function AdsOverview({ clientId, refreshKey }: { clientId: string; refreshKey?: number }) {
  const [supabase] = useState(() => createClient());
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  const cacheKey = `ptoko_ads_v1:${clientId}`;

  useEffect(() => {
    if (!clientId) return;
    // Stale-while-revalidate: paint the last-seen result instantly (huge
    // win on re-entry — this query can take several seconds), then refresh
    // in the background. This is the same pattern the main Dashboard uses.
    try {
      const raw = localStorage.getItem(cacheKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setD(JSON.parse(raw) as Summary);
    } catch { /* ignore */ }

    (async () => {
      const { data, error } = await supabase.rpc("ads_dashboard_summary", {});
      if (error) setErr(`${error.message} (code: ${error.code || "?"})`);
      else {
        setD(data as Summary);
        setErr("");
        try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* quota */ }
      }
    })();
  }, [clientId, refreshKey, supabase, cacheKey]);

  if (err && !d) {
    return (
      <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
        ⚠ Ads overview query failed: {err}
      </div>
    );
  }
  if (!d) {
    return <div className="panel" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>Memuat data…</div>;
  }

  const t = d.totals;
  const monthly = byMonth(d.monthly);
  const viewClick = byMonth(d.view_click_trend);
  const soldOmzet = byMonth(d.sold_omzet_trend);
  const products = [...(d.products || [])].sort((a, b) => (b.omzet || 0) - (a.omzet || 0));

  return (
    <>
      {err && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "10px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 12, fontFamily: "monospace" }}>
          ⚠ Refresh failed, showing last-known data: {err}
        </div>
      )}

      {/* ── Total Ads: 7 individual KPI cards, same markup as the Dashboard ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(7,1fr)" }}>
        <div className="kpi kpi-hero"><div className="kpi-icon">📣</div><div className="lbl">Ads Cost</div><div className="val">{idr(t.total.ads_cost)}</div></div>
        <div className="kpi"><div className="kpi-icon">💰</div><div className="lbl">Omzet</div><div className="val">{idr(t.total.omzet)}</div></div>
        <div className="kpi kpi-roas"><div className="lbl">ROAS</div><div className="val">{roasF(t.total.roas)}</div></div>
        <div className="kpi"><div className="kpi-icon">👁</div><div className="lbl">View</div><div className="val">{num(t.total.view)}</div></div>
        <div className="kpi"><div className="kpi-icon">🖱</div><div className="lbl">Click</div><div className="val">{num(t.total.click)}</div></div>
        <div className="kpi"><div className="kpi-icon">🧾</div><div className="lbl">Order</div><div className="val">{num(t.total.orders)}</div></div>
        <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">Item Sold</div><div className="val">{num(t.total.item_sold)}</div></div>
      </div>

      {/* ── GMV Max / Group Ads / Independent Ads ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        <CategoryCard title="GMV Max Auto" accent={BLUE} totals={t.gmv_max} />
        <CategoryCard title="Group Ads" accent={BLUE_L} totals={t.group_ads} />
        <CategoryCard title="Independent Ads" accent={GOLD} totals={t.independent} sub="Total − GMV Max − Group" />
      </div>

      {/* ── 3 charts ── */}
      <div className="row c2" style={{ marginBottom: 18 }}>
        <Panel title="Omzet by Ads Type" hint="Stacked: GMV Max → Group → Independent · line = overall ROAS">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={monthly} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={sm} tick={axis} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={axis} axisLine={false} tickLine={false} tickFormatter={idr} />
              <YAxis yAxisId="right" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => v.toFixed(1) + "×"} />
              <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => n === "ROAS" ? [roasF(Number(v)), n] : [idrF(Number(v)), n]} labelFormatter={(l) => sm(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="gmv_max_omzet" stackId="o" name="GMV Max Auto" fill={BLUE} radius={[0,0,0,0]} />
              <Bar yAxisId="left" dataKey="group_omzet" stackId="o" name="Group Ads" fill={BLUE_L} radius={[0,0,0,0]} />
              <Bar yAxisId="left" dataKey="independent_omzet" stackId="o" name="Independent Ads" fill={GOLD} radius={[3,3,0,0]} />
              <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke={GOLD_L} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="View vs Click" hint="Dilihat vs Jumlah Klik · Total Ads">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={viewClick} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={sm} tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={num} />
              <Tooltip contentStyle={TIP_STYLE} formatter={(v) => num(Number(v))} labelFormatter={(l) => sm(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="view" name="View" fill={BLUE_L} radius={[3,3,0,0]} />
              <Bar dataKey="click" name="Click" fill={GOLD} radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <Panel title="Item Sold vs Omzet" hint="Produk Terjual vs Omzet Penjualan · Total Ads">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={soldOmzet} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="month" tickFormatter={sm} tick={axis} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={axis} axisLine={false} tickLine={false} tickFormatter={num} />
              <YAxis yAxisId="right" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={idr} />
              <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => n === "Omzet" ? [idrF(Number(v)), n] : [num(Number(v)), n]} labelFormatter={(l) => sm(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="item_sold" name="Item Sold" fill={GOLD} radius={[3,3,0,0]} />
              <Line yAxisId="right" type="monotone" dataKey="omzet" name="Omzet" stroke={BLUE_L} strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* ── unified product table ── */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>Ads Product Performance</h3>
        <div className="hint" style={{ marginBottom: 14 }}>Merged from Total Ads, GMV Max, and Group Ads · joined on Kode Produk</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Kode Produk</th><th>Nama Produk</th><th className="num">Ads Cost</th><th className="num">Omzet</th>
                <th className="num">ROAS</th><th className="num">View</th><th className="num">Click</th>
                <th className="num">Order</th><th className="num">Item Sold</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.kode_produk}>
                  <td style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--muted)" }}>{p.kode_produk}</td>
                  <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.nama_produk || ""}>{p.nama_produk || "—"}</td>
                  <td className="num">{idrF(p.ads_cost)}</td>
                  <td className="num">{idrF(p.omzet)}</td>
                  <td className="num" style={{ color: GOLD_L }}>{roasF(p.roas)}</td>
                  <td className="num">{num(p.view)}</td>
                  <td className="num">{num(p.click)}</td>
                  <td className="num">{num(p.orders)}</td>
                  <td className="num">{num(p.item_sold)}</td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={9} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>No product-level ads data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CategoryCard({ title, accent, totals, sub }: { title: string; accent: string; totals: Totals; sub?: string }) {
  return (
    <div style={{ background: "linear-gradient(160deg,rgba(22,40,76,.7),rgba(9,17,36,.62))", border: `1px solid ${accent}40`, borderRadius: 16, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: .4 }}>{title}</div>
          {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: GOLD_L }}>{roasF(totals.roas)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Ads Cost</span>
        <span style={{ fontSize: 19, fontWeight: 800, color: "#fff" }}>{idrF(totals.ads_cost)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 10, columnGap: 8, fontSize: 12 }}>
        <Metric label="Omzet" value={idr(totals.omzet)} />
        <Metric label="View" value={num(totals.view)} />
        <Metric label="Click" value={num(totals.click)} />
        <Metric label="Order" value={num(totals.orders)} />
        <Metric label="Item Sold" value={num(totals.item_sold)} />
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

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div className="hint" style={{ marginBottom: 10 }}>{hint}</div>
      {children}
    </div>
  );
}
