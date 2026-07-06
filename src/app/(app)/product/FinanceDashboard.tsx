"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const GOLD = "#c9a227";
const PALETTE = ["#c9a227","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#14b8a6","#e8c84a"];

const rpC = (n: number) => {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "M";
  if (a >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return "Rp " + Math.round(v / 1e3) + "rb";
  return "Rp " + Math.round(v);
};
const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

type Kpis = {
  sales: number; promotion_cost: number; refund: number; delivery_cost: number;
  affiliate_cost: number; marketplace_fee: number; misc: number; gross_profit: number; ads_cost: number;
};
type Summary = {
  kpis: Kpis;
  monthly: { month: string; sales: number; profit: number }[];
  monthly_fee: { month: string; fee: number }[];
  monthly_discount: { month: string; discount: number }[];
  monthly_ads_cost: { month: string; ad_cost: number }[];
  monthly_costs: { month: string; promotion_cost: number; refund: number; delivery_cost: number; affiliate_cost: number; marketplace_fee: number; misc: number }[];
  payment_method: { method: string; cnt: number }[];
  jasa_kirim: { service: string; cnt: number }[];
  daily: { tx_date: string; orders: number; sales: number; promotion_cost: number; marketplace_fee: number; net_income: number; refund: number }[];
};
type ProductRow = {
  kode_produk: string; nama_produk: string | null; kode_variasi: string; nama_variasi: string | null;
  total_sales: number; total_modal: number; profit: number;
};
type ProductDetail = { rows: ProductRow[]; total_modal: number; monthly_modal: { month: string; modal: number }[] };
type Link = { owner: string | null; brand: string | null; store_name: string | null };
type FinanceFilters = { years: number[]; months: string[] };

export default function FinanceDashboard({ clientId, refreshKey }: { clientId: string; refreshKey: number }) {
  const [supabase] = useState(() => createClient());
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null); // null = checking
  const [filters, setFilters] = useState<FinanceFilters>({ years: [], months: [] });
  const [links, setLinks] = useState<Link[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", week: "", owner: "", store: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [pd, setPd] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<string | null>(null);

  const checkData = useCallback(async () => {
    if (!clientId) return;
    const { count } = await supabase.from("finance_rows").select("id", { count: "exact", head: true }).eq("client_id", clientId);
    setHasAnyData((count ?? 0) > 0);
    // server-side DISTINCT — never ships every row to the browser just to
    // build a dropdown (a plain select() truncates at 1000 rows, which
    // silently dropped later months once total uploads grew past that)
    const { data: f } = await supabase.rpc("finance_filters");
    setFilters((f as FinanceFilters) || { years: [], months: [] });
    const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", clientId);
    setLinks((sl as Link[]) || []);
  }, [supabase, clientId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { checkData(); }, [checkData, refreshKey]);

  const load = useCallback(async () => {
    if (!clientId || !hasAnyData || !sel.store) { setD(null); setPd(null); return; }
    setLoading(true);
    const params = {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_week: sel.week || null,
      p_owner: sel.owner || null,
      p_brand: null,
      p_store: sel.store,
    };
    const [{ data }, { data: pdata }] = await Promise.all([
      supabase.rpc("finance_summary", params),
      supabase.rpc("product_profit_detail", params),
    ]);
    setD(data as Summary);
    setPd(pdata as ProductDetail);
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
          <div className="big">💹</div>
          <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Upload Data Keuangan First</h3>
          <p style={{ maxWidth: 420, margin: 0 }}>No Shopee Income (Laporan Penghasilan) data has been uploaded yet. Go to the &quot;Upload Keuangan&quot; tab to import one.</p>
        </div>
      </div>
    );
  }

  const k = d?.kpis;
  const totalModal = pd?.total_modal ?? 0;
  const nettProfit = (k?.gross_profit ?? 0) - (k?.ads_cost ?? 0) - totalModal;
  const grossNettData = buildGrossNettData(d, pd);

  return (
    <>
      {/* filters — Owner then Store first: this dashboard is store-per-store, not a combined view */}
      <div className="filterbar">
        <Sel label="Owner" value={sel.owner} onChange={pickOwner} opts={owners} all="All Owners" />
        <Sel label="Store" value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesForOwner} all="Pick a store…" />
        <Sel label="Year"  value={sel.year}  onChange={(v) => setSel((s) => ({ ...s, year: v }))}  opts={years.map(String)} all="All Years" />
        <Sel label="Month" value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={months} all="All Months" />
        <Sel label="Week"  value={sel.week}  onChange={(v) => setSel((s) => ({ ...s, week: v }))}  opts={WEEKS} all="All Weeks" />
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", week: "", owner: "", store: "" })}>Reset</button>
        {loading && <Loader />}
      </div>

      {!sel.store ? (
        <div className="panel">
          <div className="coming">
            <div className="big">🏬</div>
            <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Pilih Store</h3>
            <p style={{ maxWidth: 420, margin: 0 }}>Detail Keuangan ditampilkan per store — pilih satu Store di atas untuk melihat dashboard-nya.</p>
          </div>
        </div>
      ) : (
      <>
      {/* Row 1 — headline P&L */}
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">Gross Sales</div><div className="val">{k ? rpC(k.sales) : "—"}</div><div className="kpi-sub">Harga Asli Produk (H)</div></div>
        <div className="kpi kpi-roas"><div className="kpi-icon">📈</div><div className="lbl">Gross Profit</div><div className="val">{k ? rpC(k.gross_profit) : "—"}</div><div className="kpi-sub">= Total Penghasilan (AG)</div></div>
        <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">Ads Spent</div><div className="val">{k ? rpC(k.ads_cost) : "—"}</div><div className="kpi-sub">sama seperti Dashboard Ads Cost</div></div>
        <div className="kpi"><div className="kpi-icon">🏷️</div><div className="lbl">Total Modal Product</div><div className="val">{rpC(totalModal)}</div><div className="kpi-sub">Harga Modal × unit terjual</div></div>
        <div className="kpi kpi-roas"><div className="kpi-icon">✅</div><div className="lbl">Nett Profit</div><div className="val" style={{ color: nettProfit >= 0 ? undefined : "#f87171" }}>{rpC(nettProfit)}</div><div className="kpi-sub">Gross Profit − Ads − Modal</div></div>
      </div>

      {/* Row 2 — cost breakdown (red glow on hover) */}
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi kpi-cost"><div className="kpi-icon">🎟️</div><div className="lbl">Promotion Cost</div><div className="val">{k ? rpC(k.promotion_cost) : "—"}</div><div className="kpi-sub">I, K, L, M, N, O</div></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">↩️</div><div className="lbl">Pengembalian Dana</div><div className="val">{k ? rpC(k.refund) : "—"}</div><div className="kpi-sub">J</div></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">🚚</div><div className="lbl">Delivery Cost</div><div className="val">{k ? rpC(k.delivery_cost) : "—"}</div><div className="kpi-sub">P – V</div></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">🤝</div><div className="lbl">Affiliate Cost</div><div className="val">{k ? rpC(k.affiliate_cost) : "—"}</div><div className="kpi-sub">W</div></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">🏪</div><div className="lbl">Marketplace Fee</div><div className="val">{k ? rpC(k.marketplace_fee) : "—"}</div><div className="kpi-sub">X – AE</div></div>
      </div>

      {/* Monthly Gross Sales vs Nett Profit */}
      <div className="row">
        <Panel title="Monthly Gross Sales vs Nett Profit" hint="Gross Sales (bar) vs Nett Profit setelah Ads Spent dan Total Modal Product (garis)">
          <GrossVsNettChart data={grossNettData} />
        </Panel>
      </div>

      {/* Fee + Discount */}
      <div className="row c2">
        <Panel title="Monthly Biaya Marketplace" hint="Total Admin & Layanan fee per bulan">
          <SimpleBarChart data={byMonth(d?.monthly_fee || [])} dataKey="fee" top="#8896a4" bottom="#525f6d" />
        </Panel>
        <Panel title="Monthly Promotion Cost" hint="Total diskon produk + voucher (I, K, L, M, N, O) per bulan">
          <SimpleBarChart data={byMonth(d?.monthly_discount || [])} dataKey="discount" top="#cdae66" bottom="#8c7233" />
        </Panel>
      </div>

      {/* Pies */}
      <div className="row c2">
        <Panel title="Metode Bayar" hint="Jumlah pesanan per metode pembayaran">
          <DonutChart data={(d?.payment_method || []).map((p) => ({ name: p.method, value: p.cnt }))} />
        </Panel>
        <Panel title="Jasa Kirim" hint="Jumlah pesanan per jasa kirim">
          <DonutChart data={(d?.jasa_kirim || []).map((p) => ({ name: p.service, value: p.cnt }))} />
        </Panel>
      </div>

      {/* Daily table */}
      <div className="panel">
        <h3>Detail Transaksi per Hari</h3>
        <div className="hint">Klik baris untuk melihat detail transaksi hari itu · tanggal berdasarkan dana dilepaskan</div>
        <div className="tbl-wrap" style={{ maxHeight: 440 }}>
          <table className="tbl">
            <thead><tr>
              <th>Tanggal</th><th className="num">Orders</th><th className="num">Sales</th>
              <th className="num">Promotion Cost</th><th className="num">Marketplace Fee</th>
              <th className="num">Net Income</th><th className="num">Refund</th>
            </tr></thead>
            <tbody>
              {(d?.daily || []).map((r) => (
                <tr key={r.tx_date} style={{ cursor: "pointer" }} onClick={() => setDrill(r.tx_date)}>
                  <td style={{ fontWeight: 600 }}>{fmtDate(r.tx_date)}</td>
                  <td className="num">{r.orders}</td>
                  <td className="num">{rpFull(r.sales)}</td>
                  <td className="num">{rpFull(r.promotion_cost)}</td>
                  <td className="num">{rpFull(r.marketplace_fee)}</td>
                  <td className="num" style={{ color: r.net_income >= 0 ? "#86efac" : "#f87171", fontWeight: 700 }}>{rpFull(r.net_income)}</td>
                  <td className="num">{rpFull(r.refund)}</td>
                </tr>
              ))}
              {(!d?.daily || d.daily.length === 0) && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data for these filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Product Profit */}
      <ProductProfitTable rows={pd?.rows || []} />

      {drill && (
        <DayDrillDown day={drill} clientId={clientId} sel={sel} supabase={supabase} onClose={() => setDrill(null)} />
      )}
      </>
      )}
    </>
  );
}

/* ── Detail Product Profit: search + sortable table ── */
type SortKey = "total_sales" | "total_modal" | "profit";
function ProductProfitTable({ rows }: { rows: ProductRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_sales");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = !q ? rows : rows.filter((r) =>
      (r.kode_produk || "").toLowerCase().includes(q) ||
      (r.nama_produk || "").toLowerCase().includes(q) ||
      (r.nama_variasi || "").toLowerCase().includes(q));
    list = [...list].sort((a, b) => (a[sortKey] - b[sortKey]) * (sortDir === "asc" ? 1 : -1));
    return list;
  }, [rows, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }
  const arrow = (k: SortKey) => sortKey !== k ? "" : sortDir === "asc" ? " ▲" : " ▼";

  return (
    <div className="panel">
      <h3>Detail Product Profit</h3>
      <div className="hint">Total Sales vs Total Modal Product (Harga Modal × unit terjual) per produk/variasi, untuk periode dan filter yang dipilih</div>
      <div className="filterbar" style={{ marginTop: 4, marginBottom: 10 }}>
        <div className="fld" style={{ minWidth: 260 }}>
          <label>Cari</label>
          <input type="text" placeholder="Kode Produk / Nama Produk / Nama Variasi"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 440 }}>
        <table className="tbl">
          <thead><tr>
            <th>Kode Product</th><th>Nama Product</th><th>Kode Variasi</th><th>Nama Variasi</th>
            <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("total_sales")}>Total Sales{arrow("total_sales")}</th>
            <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("total_modal")}>Total Modal Product{arrow("total_modal")}</th>
            <th className="num" style={{ cursor: "pointer" }} onClick={() => toggleSort("profit")}>Profit{arrow("profit")}</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={`${r.kode_produk}::${r.kode_variasi}`}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.kode_produk}</td>
                <td>{r.nama_produk || "—"}</td>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.kode_variasi}</td>
                <td>{r.nama_variasi || "—"}</td>
                <td className="num">{rpFull(r.total_sales)}</td>
                <td className="num">{rpFull(r.total_modal)}</td>
                <td className="num" style={{ color: r.profit >= 0 ? "#86efac" : "#f87171", fontWeight: 700 }}>{rpFull(r.profit)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No data for these filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── day drill-down overlay ── */
type DetailRow = {
  order_no: string | null; buyer_username: string | null; payment_method: string | null;
  sales: number | null; promotion_cost: number | null; marketplace_fee: number | null;
  net_income: number | null; refund: number | null; jasa_kirim: string | null; nama_kurir: string | null;
};
function DayDrillDown({ day, clientId, sel, supabase, onClose }: {
  day: string; clientId: string;
  sel: { year: string; month: string; week: string; owner: string; store: string };
  supabase: ReturnType<typeof createClient>; onClose: () => void;
}) {
  const [rows, setRows] = useState<DetailRow[] | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from("finance_rows")
        .select("order_no,buyer_username,payment_method,sales,promotion_cost,marketplace_fee,net_income,refund,jasa_kirim,nama_kurir")
        .eq("client_id", clientId).eq("release_date", day);
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
                <th>No. Pesanan</th><th>Pembeli</th><th>Metode Bayar</th>
                <th className="num">Sales</th><th className="num">Discount</th><th className="num">Fee</th>
                <th className="num">Net Income</th><th className="num">Refund</th><th>Jasa Kirim</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.order_no || "—"}</td>
                    <td>{r.buyer_username || "—"}</td>
                    <td>{r.payment_method || "—"}</td>
                    <td className="num">{rpFull(r.sales || 0)}</td>
                    <td className="num">{rpFull(Math.abs(r.promotion_cost || 0))}</td>
                    <td className="num">{rpFull(Math.abs(r.marketplace_fee || 0))}</td>
                    <td className="num" style={{ color: (r.net_income || 0) >= 0 ? "#86efac" : "#f87171" }}>{rpFull(r.net_income || 0)}</td>
                    <td className="num">{rpFull(Math.abs(r.refund || 0))}</td>
                    <td style={{ fontSize: 12 }}>{r.jasa_kirim || "—"}{r.nama_kurir ? ` · ${r.nama_kurir}` : ""}</td>
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
const byMonth = <T extends { month: string }>(a: T[]) => [...(a || [])].sort((x, y) => MONTH_ORDER.indexOf(x.month) - MONTH_ORDER.indexOf(y.month));
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
  return <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No data yet</div>;
}
type GrossNettMonth = { month: string; sales: number; nett_profit: number };
function buildGrossNettData(d: Summary | null, pd: ProductDetail | null): GrossNettMonth[] {
  const byMonth2 = <T extends { month: string }>(a: T[]) => Object.fromEntries((a || []).map((x) => [x.month, x]));
  const sales = byMonth2(d?.monthly || []);
  const ads = byMonth2(d?.monthly_ads_cost || []);
  const modal = byMonth2(pd?.monthly_modal || []);
  return byMonth(d?.monthly || []).map(({ month }) => {
    const row = sales[month] as { sales?: number; profit?: number } | undefined;
    const adCost = (ads[month] as { ad_cost?: number } | undefined)?.ad_cost ?? 0;
    const modalCost = (modal[month] as { modal?: number } | undefined)?.modal ?? 0;
    return {
      month,
      sales: row?.sales ?? 0,
      nett_profit: (row?.profit ?? 0) - adCost - modalCost,
    };
  });
}
function GrossVsNettChart({ data }: { data: GrossNettMonth[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 8 }}>
          <defs>
            <linearGradient id="gng-sales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e6c65f" />
              <stop offset="100%" stopColor="#a4801f" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => rpC(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => [rpFull(Number(v)), n === "sales" ? "Gross Sales" : "Nett Profit"]} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8}
            formatter={(v) => (v === "sales" ? "Gross Sales" : "Nett Profit")} />
          <Bar dataKey="sales" name="sales" fill="url(#gng-sales)" radius={[6, 6, 0, 0]} maxBarSize={72} />
          <Line type="monotone" dataKey="nett_profit" name="nett_profit" stroke="#6f88a4" strokeWidth={2.5}
            dot={{ r: 4, fill: "#6f88a4", strokeWidth: 0 }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
function SimpleBarChart({ data, dataKey, top, bottom }: { data: Record<string, unknown>[]; dataKey: string; top: string; bottom: string }) {
  if (!data.length) return <Empty />;
  const gid = `sbg-${dataKey}`;
  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 8 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={top} />
              <stop offset="100%" stopColor={bottom} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => rpC(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip contentStyle={TIP_STYLE} formatter={(v) => [rpFull(Number(v)), ""]} cursor={{ fill: "rgba(201,162,39,0.04)" }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} maxBarSize={104} fill={`url(#${gid})`} />
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
const drawer: React.CSSProperties = { width: "min(96vw,1100px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
