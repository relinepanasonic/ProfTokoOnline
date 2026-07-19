"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useLang } from "@/lib/i18n";
import type { CityDetailRow } from "./IndonesiaMap";

// d3-geo + topojson-client only matter to this one map — loaded client-side
// on demand instead of bundled eagerly with the rest of this dashboard.
const IndonesiaMap = dynamic(() => import("./IndonesiaMap"), { ssr: false });

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
// Brand palette — same gold/blue-only set as Dashboard/Ads Performance/
// Finance Detail (no green/red/purple/pink chart colors anywhere in this app).
const GOLD = "#c9a227", GOLD_L = "#f0d870", GOLD_D = "#8a6f1c";
const BLUE = "#3b82f6", BLUE_L = "#60a5fa", BLUE_PALE = "#93c5fd", BLUE_D = "#1d4ed8";
const PALETTE = [GOLD, BLUE, GOLD_L, BLUE_L, BLUE_PALE, GOLD_D, BLUE_D, "#f5e6a8"];

const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const numFull = (n: number) => Math.round(n || 0).toLocaleString("id-ID");
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
const fmtHours = (h: number | null) => h == null ? "—" : h < 48 ? `${h.toFixed(1)} jam` : `${(h / 24).toFixed(1)} hari`;
const fmtDays = (d: number | null) => d == null ? "—" : `${d.toFixed(1)} hari`;

type Kpis = {
  total_transaksi: number; total_produk: number; total_pembatalan: number; total_return: number;
  sla_pay_to_deadline_hours: number | null; sla_deadline_to_done_days: number | null; sla_pay_to_done_days: number | null;
};
type Summary = {
  kpis: Kpis;
  province_gmv: { province: string; gmv: number; transactions: number; product_sold: number }[];
  city_detail: CityDetailRow[];
  payment_method: { method: string; cnt: number }[];
  sla_buckets: { bucket: string; cnt: number }[];
  cancel_status: { status: string; cnt: number }[];
  shipping_option: { option: string; cnt: number }[];
  daily: { tx_date: string; orders: number; gmv: number }[];
};
type Link = { owner: string | null; brand: string | null; store_name: string | null };
type Filters = { years: number[]; months: string[] };
const SLA_ORDER = ["0-3 hari", "4-7 hari", "7-14 hari", ">14 hari"];

export default function StoreDashboard({ clientId, refreshKey }: { clientId: string; refreshKey: number }) {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<Filters>({ years: [], months: [] });
  const [links, setLinks] = useState<Link[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", week: "", owner: "", store: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<string | null>(null);

  const checkData = useCallback(async () => {
    if (!clientId) return;
    const { count } = await supabase.from("order_rows").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    setHasAnyData((count ?? 0) > 0);
    const { data: f } = await supabase.rpc("store_perf_filters");
    setFilters((f as Filters) || { years: [], months: [] });
    const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", clientId);
    setLinks((sl as Link[]) || []);
  }, [supabase, clientId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { checkData(); }, [checkData, refreshKey]);

  const load = useCallback(async () => {
    if (!clientId || !hasAnyData || !sel.store) { setD(null); return; }
    setLoading(true);
    const { data } = await supabase.rpc("store_perf_summary", {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_week: sel.week || null,
      p_owner: sel.owner || null,
      p_store: sel.store,
    });
    setD(data as Summary);
    setLoading(false);
  }, [supabase, clientId, hasAnyData, sel]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => [...filters.years].sort((a, b) => b - a), [filters.years]);
  const months = useMemo(() => [...filters.months].sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b)), [filters.months]);
  const owners = useMemo(() => Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort(), [links]);
  const storesForOwner = useMemo(() => sel.owner
    ? Array.from(new Set(links.filter((l) => l.owner === sel.owner).map((l) => l.store_name).filter(Boolean) as string[]))
    : Array.from(new Set(links.map((l) => l.store_name).filter(Boolean) as string[])), [links, sel.owner]);

  function pickOwner(owner: string) { setSel((s) => ({ ...s, owner, store: "" })); }

  if (hasAnyData === null) return <Loader center />;

  if (!hasAnyData) {
    return (
      <div className="panel">
        <div className="coming">
          <div className="big">🏬</div>
          <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>{t("Upload Data Operational Performance First")}</h3>
          <p style={{ maxWidth: 420, margin: 0 }}>{t("No Shopee Order.completed data has been uploaded yet. Go to the \"Upload Operational Performance\" tab to import one.")}</p>
        </div>
      </div>
    );
  }

  const k = d?.kpis;
  const slaBuckets = SLA_ORDER.map((b) => ({ bucket: b, cnt: d?.sla_buckets.find((x) => x.bucket === b)?.cnt ?? 0 }));

  return (
    <>
      {/* filters — Owner + Store only at first; Year/Month/Week auto-reveal once a store is picked */}
      <div className="filterbar">
        <Sel label={t("Owner")} value={sel.owner} onChange={pickOwner} opts={owners} all={t("All Owners")} />
        <Sel label={t("Store")} value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesForOwner} all={t("Pick a store…")} />
        {sel.store && (
          <>
            <Sel label={t("Year")}  value={sel.year}  onChange={(v) => setSel((s) => ({ ...s, year: v }))}  opts={years.map(String)} all={t("All Years")} />
            <Sel label={t("Month")} value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={months} all={t("All Months")} />
            <Sel label={t("Week")}  value={sel.week}  onChange={(v) => setSel((s) => ({ ...s, week: v }))}  opts={WEEKS} all={t("All Weeks")} />
          </>
        )}
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", week: "", owner: "", store: "" })}>{t("Reset")}</button>
        {loading && <Loader />}
      </div>

      {!sel.store ? (
        <div className="panel">
          <div className="coming">
            <div className="big">🏬</div>
            <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>{t("Choose Store")}</h3>
            <p style={{ maxWidth: 420, margin: 0 }}>{t("Operational Performance is shown per store — pick a Store above to view its dashboard.")}</p>
          </div>
        </div>
      ) : (
      <>
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi kpi-hero"><div className="kpi-icon">🧾</div><div className="lbl">{t("Total Transaction")}</div><div className="val">{k ? numFull(k.total_transaksi) : "—"}</div><div className="kpi-sub">{t("Unique orders")}</div></div>
        <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">{t("Total Product Ordered")}</div><div className="val">{k ? numFull(k.total_produk) : "—"}</div><div className="kpi-sub">{t("Ready to ship")}</div></div>
        <div className="kpi kpi-roas" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div className="lbl">SLA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            <SlaLine label={t("Pay → Ship Deadline")} value={fmtHours(k?.sla_pay_to_deadline_hours ?? null)} />
            <SlaLine label={t("Ship Deadline → Completed")} value={fmtDays(k?.sla_deadline_to_done_days ?? null)} />
            <SlaLine label={t("Pay → Completed")} value={fmtDays(k?.sla_pay_to_done_days ?? null)} bold />
          </div>
        </div>
        <div className="kpi kpi-cost"><div className="kpi-icon">✕</div><div className="lbl">{t("Total Cancellations")}</div><div className="val">{k ? numFull(k.total_pembatalan) : "—"}</div><div className="kpi-sub">{t("Orders cancelled")}</div></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">↩️</div><div className="lbl">{t("Total Product Return")}</div><div className="val">{k ? numFull(k.total_return) : "—"}</div><div className="kpi-sub">{t("Units returned")}</div></div>
      </div>

      {/* Map + SLA bucket, side by side */}
      <div className="row c2">
        <Panel title={t("GMV Map by Province")} hint={t("Darker color = higher GMV in that province — hover for detail")}>
          <IndonesiaMap data={d?.province_gmv || []} cityDetail={d?.city_detail || []} />
        </Panel>
        <Panel title={t("SLA (Pay → Completed)")} hint={t("Order distribution by time from payment to completion")}>
          <SimpleBarChart data={slaBuckets} dataKey="cnt" xKey="bucket" color={GOLD} t={t} />
        </Panel>
      </div>

      {/* Jenis Bayar + Jenis Kurir, side by side */}
      <div className="row c2">
        <Panel title={t("Payment Method")} hint={t("Number of orders per payment method")}>
          <DonutChart data={(d?.payment_method || []).map((p) => ({ name: p.method, value: p.cnt }))} t={t} />
        </Panel>
        <Panel title={t("Shipping Type / Option")} hint={t("Number of orders per shipping option — top 10, rest merged into Others")}>
          <DonutChart data={topNPlusOthers((d?.shipping_option || []).map((p) => ({ name: p.option, value: p.cnt })), 10, t)} t={t} />
        </Panel>
      </div>

      {/* Daily table */}
      <div className="panel">
        <h3>{t("Daily Transaction Detail")}</h3>
        <div className="hint">{t("Click a row to see that day's transaction detail · date based on order completed time")}</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr><th>{t("Date")}</th><th className="num">{t("Orders")}</th><th className="num">GMV</th></tr></thead>
            <tbody>
              {(d?.daily || []).map((r) => (
                <tr key={r.tx_date} style={{ cursor: "pointer" }} onClick={() => setDrill(r.tx_date)}>
                  <td style={{ fontWeight: 600 }}>{fmtDate(r.tx_date)}</td>
                  <td className="num">{r.orders}</td>
                  <td className="num">{rpFull(r.gmv)}</td>
                </tr>
              ))}
              {(!d?.daily || d.daily.length === 0) && (
                <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{t("No data for these filters")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drill && (
        <DayDrillDown day={drill} clientId={clientId} sel={sel} supabase={supabase} onClose={() => setDrill(null)} />
      )}
      </>
      )}
    </>
  );
}

function SlaLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: bold ? 15 : 12.5 }}>
      <span style={{ color: bold ? "#e8edf8" : "var(--muted)", fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: bold ? GOLD : "#e8edf8", fontWeight: 700 }}>{value}</span>
    </div>
  );
}

/* ── day drill-down overlay ── */
type DetailRow = {
  order_no: string | null; product_name: string | null; variant_name: string | null; qty: number | null;
  paid_at: string | null; ship_deadline: string | null; completed_at: string | null;
  payment_method: string | null; shipping_option: string | null; city: string | null; province: string | null;
  total_payment: number | null; order_status: string | null; cancel_return_status: string | null;
};
function fmtDT(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function slaFor(paid: string | null, completed: string | null): string {
  if (!paid || !completed) return "—";
  const h = (new Date(completed.replace(" ", "T")).getTime() - new Date(paid.replace(" ", "T")).getTime()) / 3600000;
  return Number.isFinite(h) ? fmtHours(h) : "—";
}
function DayDrillDown({ day, clientId, sel, supabase, onClose }: {
  day: string; clientId: string;
  sel: { year: string; month: string; week: string; owner: string; store: string };
  supabase: ReturnType<typeof createClient>; onClose: () => void;
}) {
  const { t } = useLang();
  const [rows, setRows] = useState<DetailRow[] | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from("order_rows")
        .select("order_no,product_name,variant_name,qty,paid_at,ship_deadline,completed_at,payment_method,shipping_option,city,province,total_payment,order_status,cancel_return_status")
        .eq("client_id", clientId).gte("completed_at", `${day} 00:00:00`).lte("completed_at", `${day} 23:59:59`);
      if (sel.year) q = q.eq("year", Number(sel.year));
      if (sel.month) q = q.eq("month", sel.month);
      if (sel.week) q = q.eq("week", sel.week);
      if (sel.owner) q = q.eq("pic_client", sel.owner);
      if (sel.store) q = q.eq("store_name", sel.store);
      const { data } = await q.order("order_no");
      setRows((data as DetailRow[]) || []);
    })();
  }, [day, clientId, sel, supabase]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{t("Transaction")} — {fmtDate(day)}</div>
          <button className="btn-ghost" onClick={onClose}>✕ {t("Close")}</button>
        </div>
        {rows === null ? <Loader center /> : (
          <div className="tbl-wrap" style={{ maxHeight: "72vh" }}>
            <table className="tbl" style={{ color: "#e8edf8", fontSize: 13.5 }}>
              <thead><tr>
                <th>{t("Order No.")}</th><th>{t("Product")}</th><th>{t("Variant")}</th><th className="num">Qty</th>
                <th>{t("Paid At")}</th><th>{t("Ship Deadline")}</th><th>{t("Completed At")}</th><th>SLA</th>
                <th>{t("Payment Method")}</th><th>{t("Courier")}</th><th>{t("City")}</th><th>{t("Province")}</th>
                <th className="num">Total Sales</th><th>{t("Status")}</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const showOrderNo = i === 0 || rows[i - 1].order_no !== r.order_no;
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace", fontSize: 12.5, whiteSpace: "nowrap" }}>{showOrderNo ? (r.order_no || "—") : ""}</td>
                      <td style={{ maxWidth: 220, whiteSpace: "normal" }}>{r.product_name || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.variant_name || "—"}</td>
                      <td className="num">{r.qty ?? "—"}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDT(r.paid_at)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDT(r.ship_deadline)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{fmtDT(r.completed_at)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap", fontWeight: 700, color: GOLD }}>{slaFor(r.paid_at, r.completed_at)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{r.payment_method || "—"}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{r.shipping_option || "—"}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{r.city || "—"}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{r.province || "—"}</td>
                      <td className="num">{rpFull(r.total_payment || 0)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{r.cancel_return_status || r.order_status || "—"}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={14} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{t("No transactions")}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── building blocks ── */
const axis = { fontSize: 10, fill: "#7089aa" };
const TIP_STYLE: React.CSSProperties = { background: "rgba(6,14,33,0.97)", border: "1px solid rgba(201,162,39,0.35)", borderRadius: 10, color: "#e8edf8", fontSize: 12, padding: "8px 14px" };

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
function Panel({ title, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 14px" }}>{title}</h3>
      {children}
    </div>
  );
}
function Empty() {
  const { t } = useLang();
  return <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>{t("No data yet")}</div>;
}
function SimpleBarChart({ data, dataKey, xKey, color, t }: { data: Record<string, unknown>[]; dataKey: string; xKey: string; color: string; t: (k: string) => string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey={xKey} tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
          <Tooltip contentStyle={TIP_STYLE} formatter={(v) => [numFull(Number(v)), t("Orders")]} cursor={{ fill: "rgba(201,162,39,0.04)" }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} maxBarSize={72}>{data.map((_, i) => <Cell key={i} fill={color} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
// Caps a category chart to its top N slices, folding the long tail into
// "Others" — keeps a legend of 20+ shipping options readable.
function topNPlusOthers(data: { name: string; value: number }[], n: number, t: (k: string) => string) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= n) return sorted;
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n).reduce((s, x) => s + x.value, 0);
  return rest > 0 ? [...top, { name: t("Others"), value: rest }] : top;
}
function DonutChart({ data, t }: { data: { name: string; value: number }[]; t: (k: string) => string }) {
  const filtered = data.filter((x) => x.value > 0);
  if (!filtered.length) return <Empty />;
  const total = filtered.reduce((s, x) => s + x.value, 0);
  return (
    <div style={{ width: "100%", height: 300, position: "relative" }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={filtered} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={68} outerRadius={105} paddingAngle={2} strokeWidth={0}
            label={({ percent }) => percent ? `${(percent * 100).toFixed(0)}%` : ""} labelLine={false}>
            {filtered.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="rgba(6,14,33,0.6)" strokeWidth={2} />)}
          </Pie>
          <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => [`${v} ${t("orders")}`, n as string]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10, color: "#9ab0cc", paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 10, color: "#7089aa", marginBottom: 2 }}>TOTAL</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{total} {t("orders")}</div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const drawer: React.CSSProperties = { width: "min(98vw,1900px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
