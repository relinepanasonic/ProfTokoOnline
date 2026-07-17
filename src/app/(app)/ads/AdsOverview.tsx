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
import { useEffect, useState } from "react";
import {
  Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

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

export default function AdsOverview({ clientId, refreshKey }: { clientId: string; refreshKey?: number }) {
  const [supabase] = useState(() => createClient());
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState("");

  const cacheKey = `ptoko_ads_v2:${clientId}`;

  useEffect(() => {
    if (!clientId) return;
    // Stale-while-revalidate: paint the last-seen result instantly (huge
    // win on re-entry — this query can take a few seconds), then refresh
    // in the background. Same pattern the main Dashboard uses.
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
  const soldSales = byMonth(d.sold_sales_trend);
  const groups = [...(d.groups || [])].sort((a, b) => (b.sales || 0) - (a.sales || 0));
  const products = [...(d.products || [])].sort((a, b) => (b.sales || 0) - (a.sales || 0));

  return (
    <>
      {err && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "10px 16px", marginBottom: 14, color: "#fca5a5", fontSize: 12, fontFamily: "monospace" }}>
          ⚠ Refresh failed, showing last-known data: {err}
        </div>
      )}

      {/* ── Total Ads: 7 individual KPI cards. Sales is the one hero (gold
          gradient) number, ROAS is gold-gradient text on an otherwise
          plain card, everything else is the default blue card. ── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(7,1fr)" }}>
        <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">Ads Cost</div><div className="val">{idr(t.total.ads_cost)}</div></div>
        <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">Sales</div><div className="val">{idr(t.total.sales)}</div></div>
        <div className="kpi"><div className="lbl">ROAS</div><div className="val grad-gold">{roasF(t.total.roas)}</div></div>
        <div className="kpi"><div className="kpi-icon">👁</div><div className="lbl">View</div><div className="val">{num(t.total.view)}</div></div>
        <div className="kpi"><div className="kpi-icon">🖱</div><div className="lbl">Click</div><div className="val">{num(t.total.click)}</div></div>
        <div className="kpi"><div className="kpi-icon">🧾</div><div className="lbl">Order</div><div className="val">{num(t.total.orders)}</div></div>
        <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">Item Sold</div><div className="val">{num(t.total.item_sold)}</div></div>
      </div>

      {/* ── GMV Max / Group Ads / Independent Ads ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
        <CategoryCard title="GMV Max Auto" accent={BLUE} totals={t.gmv_max} />
        <CategoryCard title="Group Ads" accent={BLUE_L} totals={t.group_ads} />
        <CategoryCard title="Independent Ads" accent={BLUE_PALE} totals={t.independent} sub="Total − GMV Max − Group" />
      </div>

      {/* ── charts ── */}
      <div className="row c2" style={{ marginBottom: 18 }}>
        <Panel title="Sales by Ads Type" hint="Stacked: GMV Max → Group → Independent · line = overall ROAS">
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
        <Panel title="Ads Funnel" hint="Dilihat → Klik → Add to Cart → Konversi · Total Ads">
          <AdsFunnel funnel={d.funnel} />
        </Panel>
      </div>

      <div className="row" style={{ marginBottom: 18 }}>
        <Panel title="Item Sold vs Sales" hint="Produk Terjual vs Omzet Penjualan · Total Ads · separate scales">
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
        <h3 style={{ margin: 0 }}>Ads Group Performance</h3>
        <div className="hint" style={{ marginBottom: 14 }}>Campaign / group-level rows (GMV Max, Grup Hero, Grup Regular, etc.) — everything without a Kode Produk</div>
        <div className="tbl-wrap" style={{ maxHeight: 360 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign Name</th><th className="num">Ads Cost</th><th className="num">Sales</th>
                <th className="num">ROAS</th><th className="num">View</th><th className="num">Click</th>
                <th className="num">Order</th><th className="num">Item Sold</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
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
              {groups.length === 0 && (
                <tr><td colSpan={8} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>No campaign/group ads data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Ads Product Performance (level='product' rows — has Kode Produk) ── */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <h3 style={{ margin: 0 }}>Ads Product Performance</h3>
        <div className="hint" style={{ marginBottom: 14 }}>Merged from Total Ads, GMV Max, and Group Ads · joined on Kode Produk</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Kode Produk</th><th>Nama Produk</th><th className="num">Ads Cost</th><th className="num">Sales</th>
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
                  <td className="num">{idrF(p.sales)}</td>
                  <td className="num grad-gold" style={{ fontWeight: 700 }}>{roasF(p.roas)}</td>
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
        <div className="grad-gold" style={{ fontSize: 15, fontWeight: 800 }}>{roasF(totals.roas)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Ads Cost</span>
        <span style={{ fontSize: 19, fontWeight: 800, color: "#fff" }}>{idrF(totals.ads_cost)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 10, columnGap: 8, fontSize: 12 }}>
        <Metric label="Sales" value={idr(totals.sales)} />
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
function AdsFunnel({ funnel }: { funnel: Funnel }) {
  const isMobile = useIsMobile();
  const { view, click, add_to_cart, orders } = funnel;
  if (!view && !click && !add_to_cart && !orders) {
    return <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px 0", fontSize: 13 }}>No ads funnel data yet</div>;
  }
  const stages = [
    { label: "View", value: view },
    { label: "Click", value: click },
    { label: "Add to Cart", value: add_to_cart },
    { label: "Order", value: orders },
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
