"use client";

import { fmtDate } from "@/lib/dates";
import { useEffect, useState, useCallback, useMemo, useId } from "react";
import {
  BarChart, Bar, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useLang } from "@/lib/i18n";
import { useTableSort } from "@/hooks/useTableSort";
import SortableHeader from "@/components/SortableHeader";
import { sortByBucket, bucketAxisLabel, bucketTooltipLabel } from "@/lib/timeBuckets";

const MONTH_ORDER = ["Baseline","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
// Brand palette — same gold/blue-only set as Dashboard/Ads Performance
// (no green/red/purple/pink chart colors anywhere in this app).
const GOLD = "#c9a227", GOLD_L = "#f0d870", GOLD_D = "#8a6f1c";
const BLUE = "#3b82f6", BLUE_L = "#60a5fa", BLUE_PALE = "#93c5fd", BLUE_D = "#1d4ed8";
const PALETTE = [GOLD, BLUE, GOLD_L, BLUE_L, BLUE_PALE, GOLD_D, BLUE_D, "#f5e6a8"];

const rpC = (n: number) => {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "M";
  if (a >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return "Rp " + Math.round(v / 1e3) + "rb";
  return "Rp " + Math.round(v);
};
const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
// "Rp 518.301  19.2%": the % (of that day's Sales) sits right of the number, one size smaller
function RpPct({ value, sales }: { value: number; sales: number }) {
  return (
    <>
      {rpFull(value)}
      <span style={{ display: "inline-block", minWidth: "3.9em", textAlign: "right", marginLeft: 6, fontSize: "calc(1em - 1px)", opacity: 0.75 }}>
        {sales > 0 ? `${(value / sales * 100).toFixed(1)}%` : "—"}
      </span>
    </>
  );
}

type Kpis = {
  sales: number; promotion_cost: number; refund: number; delivery_cost: number;
  affiliate_cost: number; marketplace_fee: number; misc: number; gross_profit: number; ads_cost: number;
};
type DailyRow = { tx_date: string; orders: number; sales: number; promotion_cost: number; marketplace_fee: number; net_income: number; refund: number };
type DailyView = DailyRow & { pajak: number };
type Summary = {
  kpis: Kpis;
  monthly: { month: string; sales: number; profit: number }[];
  // Per-day Gross Sales + Gross Profit — populated only when a month is
  // selected (Nett Profit has no honest daily form; see migration 0091).
  daily_gross: { day: string; gross_sales: number; gross_profit: number }[];
  // month value doubles as an ISO date string when a month is selected.
  monthly_fee: { month: string; fee: number }[];
  monthly_discount: { month: string; discount: number }[];
  monthly_ads_cost: { month: string; ad_cost: number }[];
  monthly_costs: { month: string; promotion_cost: number; refund: number; delivery_cost: number; affiliate_cost: number; marketplace_fee: number; misc: number }[];
  payment_method: { method: string; cnt: number }[];
  jasa_kirim: { service: string; cnt: number }[];
  daily: DailyRow[];
};
type ProductRow = {
  kode_produk: string; nama_produk: string | null; kode_variasi: string; nama_variasi: string | null;
  units_sold: number; total_sales: number; total_modal: number;
  promotion_cost: number; refund: number; delivery_cost: number; affiliate_cost: number;
  marketplace_fee: number; pajak: number; ads_cost: number; nett_profit: number;
  costing: "real" | "mixed" | "estimated";
};
type FinanceProductRow = {
  kode_produk: string; nama_produk: string | null; orders: number; sales: number;
  promotion_cost: number; refund: number; delivery_cost: number; affiliate_cost: number;
  marketplace_fee: number; pajak: number; other: number; net_income: number;
  // from the Order Completed upload (migration 0131); units null = none of this product's orders found there
  units: number | null; units_orders: number; sales_with_units: number;
};
type FinanceProductView = FinanceProductRow & { units_per_order: number | null };
// finance lines with no Order Completed match, grouped by the month the order was created (YYMM from the order number)
type MissingUnits = { ym: string; orders: number; sales: number };
type FinanceProducts = { rows: FinanceProductRow[]; missing?: MissingUnits[]; orders_total: number; orders_with_detail: number };
type NotPaidRow = {
  order_no: string; created_at: string | null; completed_at: string | null; days_waiting: number | null;
  payment_method: string | null; order_value: number | null; units: number; return_status: string | null; products: string | null;
};
type NotPaidData = {
  rows: NotPaidRow[]; not_paid_orders: number; not_paid_value: number; orders_checked: number;
  window_from: string | null; window_to: string | null;
};
type UnconnectedRow = {
  order_no: string; order_date: string | null; release_date: string | null; products: string | null;
  sales: number; net_income: number; reason: "month_missing" | "not_in_file" | "unknown";
};
type UnconnectedData = {
  rows: UnconnectedRow[]; orders_total: number; orders_connected: number;
  unconnected_orders: number; unconnected_net: number;
  by_reason: Partial<Record<UnconnectedRow["reason"], { orders: number; net: number }>>;
};
type ProductDetail = {
  rows: ProductRow[]; total_modal: number; monthly_modal: { month: string; modal: number }[];
};
type Link = { owner: string | null; brand: string | null; store_name: string | null };
type FinanceFilters = { years: number[]; months: string[] };

export default function FinanceDashboard({ clientId, refreshKey }: { clientId: string; refreshKey: number }) {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null); // null = checking
  const [filters, setFilters] = useState<FinanceFilters>({ years: [], months: [] });
  const [links, setLinks] = useState<Link[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", week: "", owner: "", store: "" });
  const [d, setD] = useState<Summary | null>(null);
  const [pd, setPd] = useState<ProductDetail | null>(null);
  const [fp, setFp] = useState<FinanceProducts | null>(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<"transaksi" | "profit" | "notpaid" | "unconnected">("transaksi");
  const [np, setNp] = useState<NotPaidData | null>(null);
  const [uc, setUc] = useState<UnconnectedData | null>(null);
  const [dailyPajak, setDailyPajak] = useState<Record<string, number>>({});

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
    if (!clientId || !hasAnyData || !sel.store) { setD(null); setPd(null); setFp(null); setUc(null); setNp(null); setDailyPajak({}); return; }
    setLoading(true);
    const params = {
      p_year: sel.year ? Number(sel.year) : null,
      p_month: sel.month || null,
      p_week: sel.week || null,
      p_owner: sel.owner || null,
      p_brand: null,
      p_store: sel.store,
    };
    const [{ data }, { data: pdata }, { data: fpdata }, { data: ucdata }, { data: dpdata }, { data: npdata }] = await Promise.all([
      supabase.rpc("finance_summary", params),
      supabase.rpc("product_profit_detail", params), // still feeds the Modal KPI and charts
      supabase.rpc("finance_product_profit", params), // the Detail Product Profit table (migration 0130)
      supabase.rpc("finance_unconnected_orders", params), // earnings with no Order Selesai row (migration 0133)
      supabase.rpc("finance_daily_pajak", params), // Pajak per release date (migration 0134)
      supabase.rpc("finance_not_paid_orders", params), // completed orders with no earning yet (migration 0135)
    ]);
    setD(data as Summary);
    setPd(pdata as ProductDetail);
    setFp((fpdata as FinanceProducts) || null);
    setUc((ucdata as UnconnectedData) || null);
    setNp((npdata as NotPaidData) || null);
    setDailyPajak(Object.fromEntries(((dpdata as { tx_date: string; pajak: number }[]) || []).map((x) => [x.tx_date, Number(x.pajak)])));
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

  // Pajak is its own column; the finance summary's marketplace fee still contains it, so take it out here
  const dailyRows = useMemo<DailyView[]>(
    () => (d?.daily || []).map((r) => {
      const pajak = dailyPajak[r.tx_date] ?? 0;
      return { ...r, pajak, marketplace_fee: Math.max(r.marketplace_fee - pajak, 0) };
    }),
    [d, dailyPajak],
  );

  function pickOwner(owner: string) { setSel((s) => ({ ...s, owner, store: "" })); }

  if (hasAnyData === null) return <Loader center />;

  if (!hasAnyData) {
    return (
      <div className="panel">
        <div className="coming">
          <div className="big">💹</div>
          <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>{t("Upload Data Keuangan First")}</h3>
          <p style={{ maxWidth: 420, margin: 0 }}>{t("No Shopee Income (Laporan Penghasilan) data has been uploaded yet. Go to the \"Upload Keuangan\" tab to import one.")}</p>
        </div>
      </div>
    );
  }

  const k = d?.kpis;
  const totalModal = pd?.total_modal ?? 0;
  const nettProfit = (k?.gross_profit ?? 0) - (k?.ads_cost ?? 0) - totalModal;
  const grossNettData = buildGrossNettData(d, pd);
  const salesSeries = seriesFrom(d?.monthly, "sales");
  const profitSeries = seriesFrom(d?.monthly, "profit");
  const adsSeries = seriesFrom(d?.monthly_ads_cost, "ad_cost");
  const modalSeries = seriesFrom(pd?.monthly_modal, "modal");
  const nettSeries = grossNettData.map((x) => x.nett_profit);
  const promoSeries = seriesFrom(d?.monthly_costs, "promotion_cost");
  const refundSeries = seriesFrom(d?.monthly_costs, "refund");
  const deliverySeries = seriesFrom(d?.monthly_costs, "delivery_cost");
  const affiliateSeries = seriesFrom(d?.monthly_costs, "affiliate_cost");
  const feeSeries = seriesFrom(d?.monthly_costs, "marketplace_fee");

  return (
    <div className="fin-compact">
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
            <p style={{ maxWidth: 420, margin: 0 }}>{t("Earning is shown per store — pick a Store above to view its dashboard.")}</p>
          </div>
        </div>
      ) : (
      <>
      {/* Row 1: Gross Sales -> Nett Profit (the P&L walk). Row 2: the 5 cost
          lines that get subtracted along the way. Was briefly one row of 10
          (kpi-grid-10) to save height, split back to 2x5 per request. */}
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi kpi-hero"><div className="kpi-icon">💰</div><div className="lbl">{t("Gross Sales")}</div><div className="val">{k ? rpC(k.sales) : "—"}</div><MiniSparkline data={salesSeries} color={GOLD} /></div>
        <div className="kpi kpi-roas"><div className="kpi-icon">📈</div><div className="lbl">{t("Gross Profit")}</div><div className="val">{k ? rpC(k.gross_profit) : "—"}</div><MiniSparkline data={profitSeries} color={GOLD} /></div>
        <div className="kpi"><div className="kpi-icon">📣</div><div className="lbl">{t("Ads Spent")}</div><div className="val">{k ? rpC(k.ads_cost) : "—"}</div><MiniSparkline data={adsSeries} color={BLUE} /></div>
        <div className="kpi"><div className="kpi-icon">🏷️</div><div className="lbl">Total Modal Product</div><div className="val">{rpC(totalModal)}</div><MiniSparkline data={modalSeries} color={GOLD_L} /></div>
        <div className="kpi kpi-roas"><div className="kpi-icon">✅</div><div className="lbl">{t("Nett Profit")}</div><div className="val" style={{ color: nettProfit >= 0 ? undefined : "#f87171" }}>{rpC(nettProfit)}</div><MiniSparkline data={nettSeries} color={GOLD} /></div>
      </div>
      <div className="kpi-grid kpi-grid-5">
        <div className="kpi kpi-cost"><div className="kpi-icon">🎟️</div><div className="lbl">{t("Promotion Cost")}</div><div className="val">{k ? rpC(k.promotion_cost) : "—"}</div><MiniSparkline data={promoSeries} color={BLUE} /></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">↩️</div><div className="lbl">{t("Refund")}</div><div className="val">{k ? rpC(k.refund) : "—"}</div><MiniSparkline data={refundSeries} color={BLUE} /></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">🚚</div><div className="lbl">{t("Delivery Cost")}</div><div className="val">{k ? rpC(k.delivery_cost) : "—"}</div><MiniSparkline data={deliverySeries} color={BLUE} /></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">🤝</div><div className="lbl">{t("Affiliate Cost")}</div><div className="val">{k ? rpC(k.affiliate_cost) : "—"}</div><MiniSparkline data={affiliateSeries} color={BLUE} /></div>
        <div className="kpi kpi-cost"><div className="kpi-icon">🏪</div><div className="lbl">{t("Marketplace Fee")}</div><div className="val">{k ? rpC(k.marketplace_fee) : "—"}</div><MiniSparkline data={feeSeries} color={BLUE} /></div>
      </div>

      {/* Gross Sales vs Nett Profit — monthly by default, or daily Gross
          Sales vs Gross Profit when a single month is selected (Nett has
          no honest daily form; see migration 0091). */}
      <div className="row">
        {(() => {
          // Daily mode only when a month is selected AND the RPC returned a
          // daily series (guards the window before migration 0091 runs).
          const showDaily = !!sel.month && (d?.daily_gross?.length ?? 0) > 0;
          return (
            <Panel title={showDaily ? t("Daily Gross Sales vs Gross Profit") : t("Monthly Gross Sales vs Nett Profit")} hint="Gross Sales (bar) vs Nett Profit setelah Ads Spent dan Total Modal Product (garis)">
              {showDaily
                ? <DailyGrossChart data={sortByBucket(d?.daily_gross || [], "day")} t={t} />
                : <GrossVsNettChart data={grossNettData} t={t} />}
            </Panel>
          );
        })()}
      </div>

      {/* Fee + Discount + Pies — one row, 4 across, so 4 breakdown charts
          only cost one stacked row's height instead of two. */}
      <div className="row c4">
        <Panel title={sel.month ? t("Daily Marketplace Fee") : t("Monthly Marketplace Fee")} hint="Total Admin & Layanan fee per bulan">
          <SimpleBarChart data={sortByBucket(d?.monthly_fee || [], "month")} dataKey="fee" top={BLUE_L} bottom={BLUE} />
        </Panel>
        <Panel title={sel.month ? t("Daily Promotion Cost") : t("Monthly Promotion Cost")} hint="Total diskon produk + voucher (I, K, L, M, N, O) per bulan">
          <SimpleBarChart data={sortByBucket(d?.monthly_discount || [], "month")} dataKey="discount" top={GOLD_L} bottom={GOLD} />
        </Panel>
        <Panel title={t("Payment Method")} hint="Jumlah pesanan per metode pembayaran">
          <DonutChart data={(d?.payment_method || []).map((p) => ({ name: p.method, value: p.cnt }))} t={t} />
        </Panel>
        <Panel title={t("Shipping Service")} hint="Jumlah pesanan per jasa kirim">
          <DonutChart data={(d?.jasa_kirim || []).map((p) => ({ name: p.service, value: p.cnt }))} t={t} />
        </Panel>
      </div>

      {/* Two big tables were stacking vertically (~400px+ each) even with
          their own maxHeight — tabbed instead of stacked so only one is
          ever on screen at a time. */}
      <div className="tbl-tabs">
        <button onClick={() => setActiveTable("transaksi")} style={tableTabBtn(activeTable === "transaksi")}>{t("Daily Transaction Detail")}</button>
        <button onClick={() => setActiveTable("profit")} style={tableTabBtn(activeTable === "profit")}>Detail Product Profit</button>
        <button onClick={() => setActiveTable("notpaid")} style={tableTabBtn(activeTable === "notpaid")}>
          {t("Not Paid Order")}{np && np.not_paid_orders > 0 ? ` (${np.not_paid_orders.toLocaleString("id-ID")})` : ""}
        </button>
        <button onClick={() => setActiveTable("unconnected")} style={tableTabBtn(activeTable === "unconnected")}>
          {t("Not Connected")}{uc && uc.unconnected_orders > 0 ? ` (${uc.unconnected_orders.toLocaleString("id-ID")})` : ""}
        </button>
      </div>
      {uc && uc.orders_total > 0 && (
        <div className="hint" style={{ margin: "-4px 0 10px", color: uc.unconnected_orders ? "#fbbf24" : "#86efac" }}>
          {t("Connected to Order Selesai")}: {uc.orders_connected.toLocaleString("id-ID")} / {uc.orders_total.toLocaleString("id-ID")} {t("orders")} ({(uc.orders_connected / uc.orders_total * 100).toFixed(1)}%)
          {uc.unconnected_orders > 0 && <> — <button onClick={() => setActiveTable("unconnected")} style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }}>{uc.unconnected_orders.toLocaleString("id-ID")} {t("not connected")}</button></>}
        </div>
      )}

      {activeTable === "transaksi" ? (
        <DailyTransactionTable rows={dailyRows} onRowClick={setDrill} t={t} />
      ) : activeTable === "profit" ? (
        <ProductProfitTable data={fp} t={t} />
      ) : activeTable === "notpaid" ? (
        <NotPaidTable data={np} t={t} />
      ) : (
        <NotConnectedTable data={uc} t={t} />
      )}

      {drill && (
        <DayDrillDown day={drill} clientId={clientId} sel={sel} supabase={supabase} onClose={() => setDrill(null)} />
      )}
      </>
      )}
    </div>
  );
}

/* ── Daily Transaction Detail: universal sortable header ── */
function DailyTransactionTable({ rows, onRowClick, t }: { rows: DailyView[]; onRowClick: (day: string) => void; t: (k: string) => string }) {
  const { sortedData, sortConfig, requestSort } = useTableSort<DailyView>(rows);
  return (
    <div className="panel">
      <h3>{t("Daily Transaction Detail")}</h3>
      <div className="hint">{t("Click a row to see that day's transaction detail · date based on release date")}</div>
      <div className="tbl-wrap" style={{ maxHeight: 350 }}>
        <table className="tbl">
          <thead><tr>
            <SortableHeader label={t("Date")} sortKey="tx_date" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label={t("Orders")} sortKey="orders" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Sales")} sortKey="sales" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Promotion Cost")} sortKey="promotion_cost" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Marketplace Fee")} sortKey="marketplace_fee" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Refund")} sortKey="refund" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Pajak")} sortKey="pajak" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Net Income")} sortKey="net_income" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
          </tr></thead>
          <tbody>
            {sortedData.map((r) => (
              <tr key={r.tx_date} style={{ cursor: "pointer" }} onClick={() => onRowClick(r.tx_date)}>
                <td style={{ fontWeight: 600 }}>{fmtDate(r.tx_date)}</td>
                <td className="num">{r.orders}</td>
                <td className="num">{rpFull(r.sales)}</td>
                <td className="num"><RpPct value={r.promotion_cost} sales={r.sales} /></td>
                <td className="num"><RpPct value={r.marketplace_fee} sales={r.sales} /></td>
                <td className="num"><RpPct value={r.refund} sales={r.sales} /></td>
                <td className="num"><RpPct value={r.pajak} sales={r.sales} /></td>
                <td className="num" style={{ color: r.net_income >= 0 ? "#86efac" : "#f87171", fontWeight: 700 }}><RpPct value={r.net_income} sales={r.sales} /></td>
              </tr>
            ))}
            {sortedData.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{t("No data for these filters")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Detail Product Profit: strictly from the finance upload (Shopee "Penghasilan" report) ──
   One row per Shopee product ID — Sales is Harga Produk, every cost is Shopee's own number
   for that product (migration 0130). No Product Performance (SPOS), Modal or Ads data. */
function ProductProfitTable({ data, t }: { data: FinanceProducts | null; t: (k: string) => string }) {
  const [search, setSearch] = useState("");
  const rows = data?.rows;

  const withUnitsPerOrder = useMemo<FinanceProductView[]>(
    () => (rows || []).map((r) => ({ ...r, units_per_order: r.units != null && r.units_orders > 0 ? r.units / r.units_orders : null })),
    [rows],
  );

  const filtered = useMemo(() => {
    const all = withUnitsPerOrder;
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      (r.kode_produk || "").toLowerCase().includes(q) ||
      (r.nama_produk || "").toLowerCase().includes(q));
  }, [withUnitsPerOrder, search]);

  const { sortedData, sortConfig, requestSort } = useTableSort<FinanceProductView>(filtered, "sales");

  const total = data?.orders_total ?? 0;
  const withDetail = data?.orders_with_detail ?? 0;
  const cell = { whiteSpace: "nowrap" } as const;

  return (
    <div className="panel">
      <h3>Detail Product Profit</h3>
      {total > 0 && withDetail < total && (
        <div className="hint" style={{ marginTop: 6, color: "#fbbf24" }}>
          {t("Product detail covers")} {withDetail.toLocaleString("id-ID")} / {total.toLocaleString("id-ID")} {t("orders")} — {t("older uploads have no per-product lines; upload the newer Penghasilan report for those months.")}
        </div>
      )}

      <div className="filterbar" style={{ marginTop: 4, marginBottom: 10 }}>
        <div className="fld" style={{ minWidth: 260 }}>
          <label>{t("Search")}</label>
          <input type="text" placeholder={t("Product Code / Product Name")}
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
      </div>
      <div className="tbl-wrap" style={{ maxHeight: 450 }}>
        <table className="tbl tbl-sticky2">
          <thead><tr>
            <th className="sticky-col sticky-col-1"><span className="sticky-inner">{t("Product Name")}</span></th>
            <th>{t("Product Code")}</th>
            <SortableHeader label={t("Orders")} sortKey="orders" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Units Sold")} sortKey="units" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Units / Order")} sortKey="units_per_order" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Sales")} sortKey="sales" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Promotional Cost")} sortKey="promotion_cost" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Refund")} sortKey="refund" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Delivery Cost")} sortKey="delivery_cost" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Affiliate Cost")} sortKey="affiliate_cost" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Market Place Fee")} sortKey="marketplace_fee" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Pajak")} sortKey="pajak" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Other")} sortKey="other" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Nett Income")} sortKey="net_income" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <th className="num" style={cell} title={t("Nett Income ÷ Sales × 100%")}>%</th>
          </tr></thead>
          <tbody>
            {sortedData.map((r) => (
              <tr key={r.kode_produk}>
                <td className="sticky-col sticky-col-1" title={r.nama_produk || undefined}><span className="sticky-inner">{r.nama_produk || "—"}</span></td>
                <td style={{ fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{r.kode_produk}</td>
                <td className="num" style={cell}>{r.orders.toLocaleString("id-ID")}</td>
                <td className="num" style={cell}
                  title={r.units != null && r.sales_with_units < r.sales * 0.995 ? `${t("Units known for")} ${(r.sales_with_units / (r.sales || 1) * 100).toFixed(0)}% ${t("of this product's Sales")}` : undefined}>
                  {r.units == null ? "—" : Math.round(r.units).toLocaleString("id-ID")}
                  {r.units != null && r.sales_with_units < r.sales * 0.995 ? <span style={{ color: "#fbbf24" }}>*</span> : null}
                </td>
                <td className="num" style={cell}>{r.units_per_order == null ? "—" : r.units_per_order.toLocaleString("id-ID", { maximumFractionDigits: 1 })}</td>
                <td className="num" style={cell}>{rpFull(r.sales)}</td>
                <td className="num" style={cell}>{rpFull(r.promotion_cost)}</td>
                <td className="num" style={cell}>{rpFull(r.refund)}</td>
                <td className="num" style={cell}>{rpFull(r.delivery_cost)}</td>
                <td className="num" style={cell}>{rpFull(r.affiliate_cost)}</td>
                <td className="num" style={cell}>{rpFull(r.marketplace_fee)}</td>
                <td className="num" style={cell}>{rpFull(r.pajak)}</td>
                <td className="num" style={cell}>{rpFull(r.other)}</td>
                <td className="num" style={{ ...cell, color: r.net_income >= 0 ? "#86efac" : "#f87171", fontWeight: 700 }}>{rpFull(r.net_income)}</td>
                <td className="num" style={{ ...cell, color: r.net_income >= 0 ? "#86efac" : "#f87171", fontWeight: 700 }}>{r.sales > 0 ? `${(r.net_income / r.sales * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
            {sortedData.length === 0 && (
              <tr><td colSpan={15} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                {total > 0 && withDetail === 0
                  ? t("No per-product data for this period. Upload the newer Shopee Penghasilan income report to see products here.")
                  : t("No data for these filters")}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Not Paid Order: orders that are completed (Order Selesai) but have no earning yet ──
   Earning is the core. An order is listed until its No. Pesanan appears in ANY finance upload,
   then it drops off (migration 0135). Orders created outside the period the Earning uploads
   cover (e.g. December when Earning starts in January) are ignored. */
function NotPaidTable({ data, t }: { data: NotPaidData | null; t: (k: string) => string }) {
  const [search, setSearch] = useState("");
  const rows = data?.rows;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => !q || r.order_no.toLowerCase().includes(q) || (r.products || "").toLowerCase().includes(q));
  }, [rows, search]);
  const { sortedData, sortConfig, requestSort } = useTableSort<NotPaidRow>(filtered, "completed_at");

  function downloadCsv() {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["No. Pesanan", "Order Created", "Order Completed", "Days Waiting", "Products", "Units", "Order Value", "Payment Method", "Return Status"];
    const lines = [head.join(",")].concat(sortedData.map((r) => [r.order_no, r.created_at, r.completed_at, r.days_waiting, r.products, r.units, r.order_value, r.payment_method, r.return_status].map(esc).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `not-paid-orders_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const count = data?.not_paid_orders ?? 0;
  const cell = { whiteSpace: "nowrap" } as const;
  const waitColor = (d: number | null) => (d == null ? "var(--muted)" : d > 14 ? "#f87171" : d > 7 ? "#fbbf24" : "inherit");

  return (
    <div className="panel">
      <h3>{t("Not Paid Order")}</h3>
      <div className="hint">
        {t("Completed (Order Selesai) orders whose earning is not in Earning yet. An order leaves this list as soon as its earning is uploaded.")}
        {data?.window_from && <> {t("Orders created")} {data.window_from} – {data.window_to} {t("(the period your Earning covers); orders outside it are ignored.")}</>}
      </div>
      {data && data.orders_checked > 0 && (
        <div className="hint" style={{ marginTop: 6, color: count ? "#fbbf24" : "#86efac" }}>
          {count
            ? <><b>{count.toLocaleString("id-ID")}</b> / {data.orders_checked.toLocaleString("id-ID")} {t("orders not paid yet")} · {t("Order Value")} {rpFull(data.not_paid_value)}</>
            : <>✓ {t("Every completed order in this period has its earning.")}</>}
        </div>
      )}

      <div className="filterbar" style={{ marginTop: 6, marginBottom: 10, alignItems: "flex-end" }}>
        <div className="fld" style={{ minWidth: 240 }}>
          <label>{t("Search")}</label>
          <input type="text" placeholder={t("Order No. / Product")} value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
        <button className="btn-ghost" onClick={downloadCsv} disabled={!sortedData.length}>⬇ {t("Download CSV")}</button>
      </div>

      <div className="tbl-wrap" style={{ maxHeight: 450 }}>
        <table className="tbl">
          <thead><tr>
            <SortableHeader label={t("Order No.")} sortKey="order_no" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label={t("Order Created")} sortKey="created_at" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label={t("Order Completed")} sortKey="completed_at" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label={t("Days Waiting")} sortKey="days_waiting" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <th>{t("Products")}</th>
            <SortableHeader label={t("Units")} sortKey="units" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Order Value")} sortKey="order_value" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <th>{t("Payment")}</th>
            <th>{t("Note")}</th>
          </tr></thead>
          <tbody>
            {sortedData.map((r) => (
              <tr key={r.order_no}>
                <td style={{ ...cell, fontFamily: "monospace", fontSize: 12 }}>{r.order_no}</td>
                <td style={cell}>{fmtDate(r.created_at)}</td>
                <td style={cell}>{fmtDate(r.completed_at)}</td>
                <td className="num" style={{ ...cell, fontWeight: 700, color: waitColor(r.days_waiting) }}>{r.days_waiting == null ? "—" : r.days_waiting}</td>
                <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }} title={r.products || undefined}>{r.products || "—"}</td>
                <td className="num" style={cell}>{Math.round(r.units).toLocaleString("id-ID")}</td>
                <td className="num" style={cell}>{r.order_value == null ? "—" : rpFull(r.order_value)}</td>
                <td style={{ ...cell, fontSize: 12 }}>{r.payment_method || "—"}</td>
                <td style={{ ...cell, fontSize: 11.5, color: "#fbbf24" }}>{r.return_status ? t("Return approved") : ""}</td>
              </tr>
            ))}
            {sortedData.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                {data?.window_from ? t("No unpaid orders.") : t("Upload Earning for this store first — nothing to compare yet.")}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Not Connected: earnings (finance orders) with no Order Selesai row ──
   Finance is the base; an earning is connected when its order number exists in an
   Order Completed upload of any month (migration 0133). Nothing here is dropped from
   Earning — these orders are fully counted, they just have no units / order details. */
function NotConnectedTable({ data, t }: { data: UnconnectedData | null; t: (k: string) => string }) {
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<"" | UnconnectedRow["reason"]>("");
  const rows = data?.rows;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (!reason || r.reason === reason) &&
      (!q || r.order_no.toLowerCase().includes(q) || (r.products || "").toLowerCase().includes(q)));
  }, [rows, search, reason]);
  const { sortedData, sortConfig, requestSort } = useTableSort<UnconnectedRow>(filtered, "order_date");

  const reasonLabel = (r: UnconnectedRow["reason"]) =>
    r === "month_missing" ? t("Order Completed month not uploaded")
    : r === "not_in_file" ? t("Not in the uploaded Order Completed")
    : t("No created date");
  const reasonColor = (r: UnconnectedRow["reason"]) => (r === "month_missing" ? "#fbbf24" : r === "not_in_file" ? "#f87171" : "var(--muted)");

  function downloadCsv() {
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["No. Pesanan", "Order Created", "Funds Released", "Products", "Sales", "Nett Income", "Reason"];
    const lines = [head.join(",")].concat(sortedData.map((r) => [r.order_no, r.order_date, r.release_date, r.products, r.sales, r.net_income, reasonLabel(r.reason)].map(esc).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `earning-not-connected_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const total = data?.orders_total ?? 0;
  const connected = data?.orders_connected ?? 0;
  const open = data?.unconnected_orders ?? 0;
  const cell = { whiteSpace: "nowrap" } as const;
  const br = data?.by_reason || {};

  return (
    <div className="panel">
      <h3>{t("Earning not connected to Order Selesai")}</h3>
      <div className="hint">
        {t("Finance is the base. An earning is connected when its order number (No. Pesanan) is in an Order Completed upload — any month. These earnings are still fully counted in Earning; they only lack units and order details.")}
      </div>
      {total > 0 && open === 0 && (
        <div className="hint" style={{ marginTop: 8, color: "#86efac" }}>✓ {t("All earnings are connected to Order Selesai.")} ({connected.toLocaleString("id-ID")} / {total.toLocaleString("id-ID")})</div>
      )}
      {open > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          {connected.toLocaleString("id-ID")} / {total.toLocaleString("id-ID")} {t("orders connected")} · <b>{open.toLocaleString("id-ID")}</b> {t("not connected")} · {t("Nett Income")} {rpFull(data?.unconnected_net ?? 0)}
          {br.month_missing && <div style={{ color: "#fbbf24" }}>• {br.month_missing.orders.toLocaleString("id-ID")} {t("orders: Order Completed for the month they were created is not uploaded yet — upload it and they connect automatically.")}</div>}
          {br.not_in_file && <div style={{ color: "#f87171" }}>• {br.not_in_file.orders.toLocaleString("id-ID")} {t("orders: that month is uploaded but these orders are not in it (cancelled, returned or never reached Selesai).")}</div>}
          {br.unknown && <div>• {br.unknown.orders.toLocaleString("id-ID")} {t("orders: the income report has no created date for them.")}</div>}
        </div>
      )}

      <div className="filterbar" style={{ marginTop: 6, marginBottom: 10, alignItems: "flex-end" }}>
        <div className="fld" style={{ minWidth: 240 }}>
          <label>{t("Search")}</label>
          <input type="text" placeholder={t("Order No. / Product")} value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
        <div className="fld">
          <label>{t("Reason")}</label>
          <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            <option value="">{t("All")}</option>
            <option value="month_missing">{t("Order Completed month not uploaded")}</option>
            <option value="not_in_file">{t("Not in the uploaded Order Completed")}</option>
            <option value="unknown">{t("No created date")}</option>
          </select>
        </div>
        <button className="btn-ghost" onClick={downloadCsv} disabled={!sortedData.length}>⬇ {t("Download CSV")}</button>
      </div>

      <div className="tbl-wrap" style={{ maxHeight: 450 }}>
        <table className="tbl">
          <thead><tr>
            <SortableHeader label={t("Order No.")} sortKey="order_no" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label={t("Order Created")} sortKey="order_date" currentSort={sortConfig} onRequestSort={requestSort} />
            <SortableHeader label={t("Funds Released")} sortKey="release_date" currentSort={sortConfig} onRequestSort={requestSort} />
            <th>{t("Products")}</th>
            <SortableHeader label={t("Sales")} sortKey="sales" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <SortableHeader label={t("Nett Income")} sortKey="net_income" currentSort={sortConfig} onRequestSort={requestSort} className="num" />
            <th>{t("Reason")}</th>
          </tr></thead>
          <tbody>
            {sortedData.map((r) => (
              <tr key={r.order_no}>
                <td style={{ ...cell, fontFamily: "monospace", fontSize: 12 }}>{r.order_no}</td>
                <td style={cell}>{fmtDate(r.order_date)}</td>
                <td style={cell}>{fmtDate(r.release_date)}</td>
                <td style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }} title={r.products || undefined}>{r.products || "—"}</td>
                <td className="num" style={cell}>{rpFull(r.sales)}</td>
                <td className="num" style={cell}>{rpFull(r.net_income)}</td>
                <td style={{ ...cell, fontSize: 11.5, fontWeight: 700, color: reasonColor(r.reason) }}>{reasonLabel(r.reason)}</td>
              </tr>
            ))}
            {sortedData.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                {open === 0 ? t("Nothing to show — every earning is connected.") : t("No data for these filters")}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── day drill-down overlay ── */
type DetailRow = {
  order_no: string | null; buyer_username: string | null;
  sales: number | null; promotion_cost: number | null; refund: number | null;
  delivery_cost: number | null; affiliate_cost: number | null; marketplace_fee: number | null;
  net_income: number | null;
};
function DayDrillDown({ day, clientId, sel, supabase, onClose }: {
  day: string; clientId: string;
  sel: { year: string; month: string; week: string; owner: string; store: string };
  supabase: ReturnType<typeof createClient>; onClose: () => void;
}) {
  const { t } = useLang();
  const [rows, setRows] = useState<DetailRow[] | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from("finance_rows")
        .select("order_no,buyer_username,sales,promotion_cost,refund,delivery_cost,affiliate_cost,marketplace_fee,net_income")
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
          <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{t("Transaction")} — {fmtDate(day)}</div>
          <button className="btn-ghost" onClick={onClose}>✕ {t("Close")}</button>
        </div>
        {rows === null ? <Loader center /> : (
          <div className="tbl-wrap" style={{ maxHeight: "70vh" }}>
            <table className="tbl" style={{ color: "#e8edf8", fontSize: 14.5 }}>
              <thead><tr>
                <th>{t("Order No.")}</th><th>{t("Buyer")}</th>
                <th className="num">{t("Sales")}</th><th className="num">{t("Promotional Cost")}</th>
                <th className="num">{t("Refund")}</th><th className="num">{t("Delivery Cost")}</th>
                <th className="num">{t("Affiliate")}</th><th className="num">{t("Market Place Fee")}</th>
                <th className="num">{t("Gross Profit")}</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ height: 48 }}>
                    <td style={{ fontFamily: "monospace", fontSize: 13 }}>{r.order_no || "—"}</td>
                    <td>{r.buyer_username || "—"}</td>
                    <td className="num">{rpFull(r.sales || 0)}</td>
                    <td className="num">{rpFull(Math.abs(r.promotion_cost || 0))}</td>
                    <td className="num">{rpFull(Math.abs(r.refund || 0))}</td>
                    <td className="num">{rpFull(Math.abs(r.delivery_cost || 0))}</td>
                    <td className="num">{rpFull(Math.abs(r.affiliate_cost || 0))}</td>
                    <td className="num">{rpFull(Math.abs(r.marketplace_fee || 0))}</td>
                    <td className="num" style={{ color: (r.net_income || 0) >= 0 ? "#86efac" : "#f87171", fontWeight: 700 }}>{rpFull(r.net_income || 0)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{t("No transactions")}</td></tr>}
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
function seriesFrom<T extends { month: string }>(arr: T[] | undefined, key: keyof T): number[] {
  return byMonth(arr || []).map((x) => Number(x[key]) || 0);
}
// Tiny inline trend line for a KPI card — replaces the old text sub-label.
// Catmull-Rom -> cubic-bezier smoothing (tension 1/6, the standard
// conversion) — turns the sharp polyline into a smooth curve without
// pulling in a charting library for an inline KPI-card sparkline.
function smoothPath(coords: (readonly [number, number])[]): string {
  if (coords.length < 2) return "";
  let d = `M${coords[0][0].toFixed(2)},${coords[0][1].toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? i : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}
function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const gid = "fin-spk-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  if (data.length < 2) return <div style={{ height: 26 }} />;
  const w = 100, h = 26, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = (w - 2 * pad) / (data.length - 1);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const coords = data.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = smoothPath(coords);
  const [lastX, lastY] = coords[coords.length - 1];
  const area = `${line} L${lastX.toFixed(2)},${h} L${coords[0][0].toFixed(2)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 26, marginTop: 6, display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.75} />
      <circle cx={lastX} cy={lastY} r={2.3} fill={color} />
    </svg>
  );
}
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
  return <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>{t("No data yet")}</div>;
}
function tableTabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "9px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
    background: active ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
    color: active ? "var(--navy-deep)" : "#cdd9f0",
  };
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
function GrossVsNettChart({ data, t }: { data: GrossNettMonth[]; t: (k: string) => string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 8 }}>
          <defs>
            <linearGradient id="gng-sales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD_L} />
              <stop offset="100%" stopColor={GOLD} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => rpC(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => [rpFull(Number(v)), n === "sales" ? t("Gross Sales") : t("Nett Profit")]} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8}
            formatter={(v) => (v === "sales" ? t("Gross Sales") : t("Nett Profit"))} />
          <Bar dataKey="sales" name="sales" fill="url(#gng-sales)" radius={[6, 6, 0, 0]} maxBarSize={72} />
          <Line type="monotone" dataKey="nett_profit" name="nett_profit" stroke={BLUE} strokeWidth={2.5}
            dot={{ r: 4, fill: BLUE, strokeWidth: 0 }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
// Daily variant shown when a single month is selected: Gross Sales (bar) +
// Gross Profit (line) — both real per-transaction finance_rows fields, so
// unlike Nett Profit they have an honest daily form.
type DailyGrossRow = { day: string; gross_sales: number; gross_profit: number };
function DailyGrossChart({ data, t }: { data: DailyGrossRow[]; t: (k: string) => string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 4, right: 20, top: 18, bottom: 8 }}>
          <defs>
            <linearGradient id="dgc-sales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD_L} />
              <stop offset="100%" stopColor={GOLD} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={bucketAxisLabel} tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => rpC(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip contentStyle={TIP_STYLE} labelFormatter={(l) => bucketTooltipLabel(String(l))}
            formatter={(v, n) => [rpFull(Number(v)), n === "gross_sales" ? t("Gross Sales") : t("Gross Profit")]} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8}
            formatter={(v) => (v === "gross_sales" ? t("Gross Sales") : t("Gross Profit"))} />
          <Bar dataKey="gross_sales" name="gross_sales" fill="url(#dgc-sales)" radius={[6, 6, 0, 0]} maxBarSize={40} />
          <Line type="monotone" dataKey="gross_profit" name="gross_profit" stroke={BLUE} strokeWidth={2.5}
            dot={{ r: 3, fill: BLUE, strokeWidth: 0 }} activeDot={{ r: 5 }} />
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
          <XAxis dataKey="month" tickFormatter={bucketAxisLabel} tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} tickFormatter={(v) => rpC(Number(v))} axisLine={false} tickLine={false} width={58} />
          <Tooltip contentStyle={TIP_STYLE} labelFormatter={(l) => bucketTooltipLabel(String(l))} formatter={(v) => [rpFull(Number(v)), ""]} cursor={{ fill: "rgba(201,162,39,0.04)" }} />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]} maxBarSize={104} fill={`url(#${gid})`} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function DonutChart({ data, t }: { data: { name: string; value: number }[]; t: (k: string) => string }) {
  const filtered = data.filter((x) => x.value > 0);
  if (!filtered.length) return <Empty />;
  const total = filtered.reduce((s, x) => s + x.value, 0);
  // A long tail (Shipping Service routinely has 15-20 distinct couriers) was
  // rendering one outside label per slice — a pile of overlapping "0%"s —
  // and a legend taller than the chart itself. Keep the top slices by
  // volume and fold the rest into one "Others" wedge; that alone fixes both
  // problems, since there are now at most MAX_SLICES+1 labels/legend rows
  // regardless of how many raw categories exist.
  const MAX_SLICES = 6;
  const sorted = [...filtered].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, MAX_SLICES);
  const restTotal = sorted.slice(MAX_SLICES).reduce((s, x) => s + x.value, 0);
  const chartData = restTotal > 0 ? [...top, { name: t("Others"), value: restTotal }] : top;
  return (
    <div style={{ width: "100%", height: 240, position: "relative" }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={80} paddingAngle={2} strokeWidth={0}
            // Skip the label on slivers too thin to fit a number legibly —
            // that overlap is what made the chart look messy in the first
            // place. Tiny slices are still fully visible in the legend/tooltip.
            label={({ percent }) => percent && percent >= 0.06 ? `${(percent * 100).toFixed(0)}%` : ""} labelLine={false}>
            {chartData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="rgba(6,14,33,0.6)" strokeWidth={2} />)}
          </Pie>
          <Tooltip contentStyle={TIP_STYLE} formatter={(v, n) => [`${v} ${t("orders")}`, n as string]} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 9.5, color: "#9ab0cc", paddingTop: 6, lineHeight: "16px" }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 9, color: "#7089aa", marginBottom: 2 }}>TOTAL</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: GOLD }}>{total} {t("orders")}</div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const drawer: React.CSSProperties = { width: "min(98vw,1600px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
