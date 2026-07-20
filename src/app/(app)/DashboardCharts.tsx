"use client";

// Split out of page.tsx and loaded via next/dynamic({ ssr: false }) — this is
// the only place recharts is imported for the main Dashboard, so this whole
// module (plus its ~1.3MB of recharts) only downloads for users who actually
// view the dashboard's charts, and never during SSR.
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, AreaChart, Area, Cell, Legend,
} from "recharts";
import { bucketAxisLabel } from "@/lib/timeBuckets";

// Shared with globals.css's mobile breakpoint (max-width:760px). Duplicated
// from page.tsx (rather than imported) so this chunk has no dependency back
// on the page module — keeps it a clean, independently-loadable split point.
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

function Empty() {
  return (
    <div style={{ height:280, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted)", fontSize:13 }}>
      No data yet
    </div>
  );
}

/* ─── SVG gradient + filter defs (referenced via url(#id) by the charts below) ─── */
export function ChartDefs() {
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

// Merge monthly_sales + traffic_trend into one series for the combined chart.
// Typed narrowly (not the full Summary type) to avoid a cross-file coupling
// back to page.tsx — this module is meant to be a self-contained split point.
export function buildMonthlyPerf(d: {
  monthly_sales?: { month: string; sales: number }[];
  traffic_trend?: { month: string; traffic: number; in_cart: number }[];
} | null): { month: string; sales: number; traffic: number; in_cart: number }[] {
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
     axis) + Traffic and In-Cart as blue lines (secondary, count axis). ── */
export function MonthlySalesChart({ data }: { data: { month: string; sales: number; traffic: number; in_cart: number }[] }) {
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
          <XAxis dataKey="month" tickFormatter={bucketAxisLabel} tick={axis} interval={0} axisLine={false} tickLine={false} height={28} />
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
export function HBarsChart({ data }: { data: { name:string; sales:number }[] }) {
  const isMobile = useIsMobile();
  if (!data.length) return <Empty />;
  const labelMax = isMobile ? 20 : 46;
  const yWidth = isMobile ? 118 : 280;
  const rows = data.map((p, i) => ({
    ...p,
    label: (i+1)+". "+(p.name.length>labelMax ? p.name.slice(0,labelMax)+"…" : p.name),
  }));
  const max = Math.max(...rows.map((r) => r.sales), 1);
  return (
    <div style={{ width:"100%", height:320 }}>
      <ResponsiveContainer>
        <BarChart layout="vertical" data={rows} barSize={16} margin={{ left:8, right:24, top:4, bottom:4 }} barCategoryGap="18%">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis type="number" tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} domain={[0, max * 1.12]} />
          <YAxis type="category" dataKey="label" tick={{ fontSize: isMobile ? 9 : 10, fill:"#9ab0cc" }} width={yWidth} axisLine={false} tickLine={false} />
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
export function CostRoasChart({ data }: { data: { month:string; cost:number; roas:number|null }[] }) {
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

/* ── AVG Store Sales Performa — one bar per store: that store's total SPOS
     sales across its own active (non-baseline) months, divided by how many
     months it actually has data for. ── */
export function AvgStoreTrendChart({ data }: { data: { store_name: string; avg_sales: number }[] }) {
  const isMobile = useIsMobile();
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 290 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="store_name"
            tick={{ ...axis, fontSize: isMobile ? 7.5 : 10.5 }}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={60}
            axisLine={false}
            tickLine={false}
          />
          <YAxis tick={axis} tickFormatter={(v) => idr(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip
            contentStyle={TIP_STYLE}
            cursor={{ fill: "rgba(59,130,246,0.08)" }}
            formatter={(v) => [idrF(Number(v)), "AVG Sales / Bulan"]}
          />
          <Bar dataKey="avg_sales" shape={<Bar3D fill="url(#gNavy)" />} radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Traffic vs In-Cart area chart ── */
export function TrafficChart({ data }: { data: { month:string; traffic:number; in_cart:number }[] }) {
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

/* ── Store drill-down modal: monthly Sales vs ROAS for one store ── */
export function StoreDrillDown({ store, storeLabel, t, onClose }: {
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
