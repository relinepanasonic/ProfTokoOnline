"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import IndonesiaMap from "./IndonesiaMap";

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const GOLD = "#c9a227";
const PALETTE = ["#c9a227","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#14b8a6","#e8c84a"];

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
  province_gmv: { province: string; gmv: number }[];
  city_gmv: { city: string; province: string; gmv: number }[];
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
  const [supabase] = useState(() => createClient());
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<Filters>({ years: [], months: [] });
  const [links, setLinks] = useState<Link[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", week: "", owner: "", store: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
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
          <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Upload Data Operational Performance First</h3>
          <p style={{ maxWidth: 420, margin: 0 }}>No Shopee Order.completed data has been uploaded yet. Go to the &quot;Upload Operational Performance&quot; tab to import one.</p>
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
        <Sel label="Owner" value={sel.owner} onChange={pickOwner} opts={owners} all="All Owners" />
        <Sel label="Store" value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesForOwner} all="Pick a store…" />
        {sel.store && (
          <>
            <Sel label="Year"  value={sel.year}  onChange={(v) => setSel((s) => ({ ...s, year: v }))}  opts={years.map(String)} all="All Years" />
            <Sel label="Month" value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={months} all="All Months" />
            <Sel label="Week"  value={sel.week}  onChange={(v) => setSel((s) => ({ ...s, week: v }))}  opts={WEEKS} all="All Weeks" />
          </>
        )}
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", week: "", owner: "", store: "" })}>Reset</button>
        {loading && <Loader />}
      </div>

      {!sel.store ? (
        <div className="panel">
          <div className="coming">
            <div className="big">🏬</div>
            <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Pilih Store</h3>
            <p style={{ maxWidth: 420, margin: 0 }}>Operational Performance ditampilkan per store — pilih satu Store di atas untuk melihat dashboard-nya.</p>
          </div>
        </div>
      ) : (
      <>
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi kpi-hero"><div className="kpi-icon">🧾</div><div className="lbl">Total Transaksi</div><div className="val">{k ? numFull(k.total_transaksi) : "—"}</div><div className="kpi-sub">Pesanan unik</div></div>
        <div className="kpi"><div className="kpi-icon">📦</div><div className="lbl">Total Produk Dipesan</div><div className="val">{k ? numFull(k.total_produk) : "—"}</div><div className="kpi-sub">Siap dikirim</div></div>
        <div className="kpi kpi-roas" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div className="lbl">SLA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            <SlaLine label="Bayar → Batas Kirim" value={fmtHours(k?.sla_pay_to_deadline_hours ?? null)} />
            <SlaLine label="Batas Kirim → Selesai" value={fmtDays(k?.sla_deadline_to_done_days ?? null)} />
            <SlaLine label="Bayar → Selesai" value={fmtDays(k?.sla_pay_to_done_days ?? null)} bold />
          </div>
        </div>
        <div className="kpi kpi-cost"><div className="kpi-icon">✕</div><div className="lbl">Total Pembatalan</div><div className="val">{k ? numFull(k.total_pembatalan) : "—"}</div><div className="kpi-sub">Pesanan dibatalkan</div></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">↩️</div><div className="lbl">Total Product Return</div><div className="val">{k ? numFull(k.total_return) : "—"}</div><div className="kpi-sub">Unit dikembalikan</div></div>
      </div>

      {/* Map */}
      <div className="row">
        <Panel title="Peta GMV per Provinsi" hint="Semakin gelap warna, semakin tinggi GMV di provinsi tersebut — arahkan kursor untuk detail">
          <IndonesiaMap data={d?.province_gmv.map((p) => ({ province: p.province, gmv: p.gmv })) || []} />
        </Panel>
      </div>

      {/* Jenis Bayar + SLA bucket */}
      <div className="row c2">
        <Panel title="Jenis Bayar" hint="Jumlah pesanan per metode pembayaran">
          <DonutChart data={(d?.payment_method || []).map((p) => ({ name: p.method, value: p.cnt }))} />
        </Panel>
        <Panel title="SLA (Bayar → Selesai)" hint="Distribusi pesanan berdasarkan lama waktu bayar sampai selesai">
          <SimpleBarChart data={slaBuckets} dataKey="cnt" xKey="bucket" color={GOLD} />
        </Panel>
      </div>

      {/* Cancellation + shipping option */}
      <div className="row c2">
        <Panel title="Status Pembatalan" hint="Jumlah pesanan per status pembatalan/pengembalian">
          <DonutChart data={(d?.cancel_status || []).map((p) => ({ name: p.status, value: p.cnt }))} />
        </Panel>
        <Panel title="Jenis Kurir / Opsi Kirim" hint="Jumlah pesanan per opsi pengiriman">
          <DonutChart data={(d?.shipping_option || []).map((p) => ({ name: p.option, value: p.cnt }))} />
        </Panel>
      </div>

      {/* Daily table */}
      <div className="panel">
        <h3>Detail Transaksi per Hari</h3>
        <div className="hint">Klik baris untuk melihat detail transaksi hari itu · tanggal berdasarkan waktu pesanan selesai</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr><th>Tanggal</th><th className="num">Orders</th><th className="num">GMV</th></tr></thead>
            <tbody>
              {(d?.daily || []).map((r) => (
                <tr key={r.tx_date} style={{ cursor: "pointer" }} onClick={() => setDrill(r.tx_date)}>
                  <td style={{ fontWeight: 600 }}>{fmtDate(r.tx_date)}</td>
                  <td className="num">{r.orders}</td>
                  <td className="num">{rpFull(r.gmv)}</td>
                </tr>
              ))}
              {(!d?.daily || d.daily.length === 0) && (
                <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data for these filters</td></tr>
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
  payment_method: string | null; shipping_option: string | null; city: string | null; province: string | null;
  total_payment: number | null; order_status: string | null; cancel_return_status: string | null;
};
function DayDrillDown({ day, clientId, sel, supabase, onClose }: {
  day: string; clientId: string;
  sel: { year: string; month: string; week: string; owner: string; store: string };
  supabase: ReturnType<typeof createClient>; onClose: () => void;
}) {
  const [rows, setRows] = useState<DetailRow[] | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from("order_rows")
        .select("order_no,product_name,variant_name,qty,payment_method,shipping_option,city,province,total_payment,order_status,cancel_return_status")
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
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Transaksi — {fmtDate(day)}</div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        {rows === null ? <Loader center /> : (
          <div className="tbl-wrap" style={{ maxHeight: "65vh" }}>
            <table className="tbl" style={{ color: "#e8edf8" }}>
              <thead><tr>
                <th>No. Pesanan</th><th>Produk</th><th>Variasi</th><th className="num">Qty</th>
                <th>Metode Bayar</th><th>Opsi Kirim</th><th>Kota / Provinsi</th>
                <th className="num">Total Pembayaran</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.order_no || "—"}</td>
                    <td style={{ maxWidth: 200, whiteSpace: "normal" }}>{r.product_name || "—"}</td>
                    <td>{r.variant_name || "—"}</td>
                    <td className="num">{r.qty ?? "—"}</td>
                    <td style={{ fontSize: 12 }}>{r.payment_method || "—"}</td>
                    <td style={{ fontSize: 12 }}>{r.shipping_option || "—"}</td>
                    <td style={{ fontSize: 12 }}>{r.city || "—"}{r.province ? `, ${r.province}` : ""}</td>
                    <td className="num">{rpFull(r.total_payment || 0)}</td>
                    <td style={{ fontSize: 12 }}>{r.cancel_return_status || r.order_status || "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No transactions</td></tr>}
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
function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3 style={{ margin: "0 0 2px" }}>{title}</h3>
      <div className="hint" style={{ marginBottom: 14 }}>{hint}</div>
      {children}
    </div>
  );
}
function Empty() {
  return <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>;
}
function SimpleBarChart({ data, dataKey, xKey, color }: { data: Record<string, unknown>[]; dataKey: string; xKey: string; color: string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey={xKey} tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
          <Tooltip contentStyle={TIP_STYLE} formatter={(v) => [numFull(Number(v)), "Pesanan"]} cursor={{ fill: "rgba(201,162,39,0.04)" }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} maxBarSize={72}>{data.map((_, i) => <Cell key={i} fill={color} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function DonutChart({ data }: { data: { name: string; value: number }[] }) {
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
          <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => [`${v} pesanan`, n as string]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10, color: "#9ab0cc", paddingTop: 8 }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 10, color: "#7089aa", marginBottom: 2 }}>TOTAL</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{total} pesanan</div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const drawer: React.CSSProperties = { width: "min(96vw,1200px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
