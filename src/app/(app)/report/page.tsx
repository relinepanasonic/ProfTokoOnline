"use client";

// Client-facing PDF report. Reached from the Dashboard's Report button, which
// passes the active filters through the URL so the report always matches what
// the user was looking at.
//
// This page is the ON-SCREEN preview only. The actual downloadable PDF is a
// server-rendered A4-landscape deck (lib/reportPdf.tsx via /api/reports/pdf) —
// real vector text, exact page geometry, no print dialog. Download here and
// the Dashboard's Report button hit the same endpoint, so there is only one
// PDF artifact and the two can't drift apart.
//
// Rendered light-themed rather than in the app's dark theme: dark backgrounds
// waste ink and read badly on paper. See globals.css `.rpt`.
//
// It deliberately calls the SAME RPCs the Dashboard uses (dashboard_summary /
// ads_dashboard_summary), never its own aggregation: the report must reconcile
// exactly with the dashboard, and both are already rollup-backed so this adds
// no new query cost.

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useLang } from "@/lib/i18n";
import {
  buildInsights, computeMetrics, priorMonth, scopeLabel, pctDelta,
  idrFull, idrShort, numFmt, pctFmt, roasFmt,
  type Summary, type AdsSummary, type Insight, type Lang,
} from "@/lib/reportInsights";

export const dynamic = "force-dynamic";

const CHART_W = 980;


export default function ReportPage() {
  return (
    <Suspense fallback={<Loader center />}>
      <ReportInner />
    </Suspense>
  );
}

function ReportInner() {
  const { t, lang } = useLang();
  const qs = useSearchParams();
  const [supabase] = useState(() => createClient());

  const sel = {
    year:  qs.get("year")  || "",
    month: qs.get("month") || "",
    owner: qs.get("owner") || "",
    brand: qs.get("brand") || "",
    store: qs.get("store") || "",
  };

  const [cur, setCur] = useState<Summary | null>(null);
  const [prev, setPrev] = useState<Summary | null>(null);
  const [baseline, setBaseline] = useState<Summary | null>(null);
  const [ads, setAds] = useState<AdsSummary | null>(null);
  const [clientName, setClientName] = useState("");
  const [storeLabel, setStoreLabel] = useState("Stores");
  const [partialWeeks, setPartialWeeks] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);

  const prevM = priorMonth(sel.month || null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setErr("AUTH_REQUIRED"); setLoading(false); return; }

    const { data: p } = await supabase
      .from("profiles").select("client_id,role,scope_owner").eq("id", user.id).single();
    const prof = p as { client_id: string | null; role: string; scope_owner: string | null } | null;
    const isOwner = prof?.role === "branch_manager";
    // An Owner is hard-scoped to their own scope_owner regardless of the URL —
    // the same rule the Dashboard enforces, so a hand-edited link can't widen
    // the report beyond what that login may see.
    const owner = isOwner ? (prof?.scope_owner || "") : sel.owner;
    const cid = isOwner
      ? (prof?.client_id || "")
      : ((await supabase.from("clients").select("id").order("created_at").limit(1)).data as { id: string }[] | null)?.[0]?.id || "";

    if (cid) {
      const { data: c } = await supabase.from("clients").select("name,store_label").eq("id", cid).single();
      const cc = c as { name: string | null; store_label: string | null } | null;
      if (cc?.name) setClientName(cc.name);
      if (cc?.store_label) setStoreLabel(cc.store_label);
    }

    const common = {
      p_client_id: cid,
      p_year: sel.year ? Number(sel.year) : null,
      p_city: null,
      p_owner: owner || null,
      p_brand: sel.brand || null,
      p_store: sel.store || null,
    };

    const [curR, prevR, baseR, adsR] = await Promise.all([
      supabase.rpc("dashboard_summary", { ...common, p_month: sel.month || null }),
      prevM ? supabase.rpc("dashboard_summary", { ...common, p_month: prevM }) : Promise.resolve({ data: null, error: null }),
      supabase.rpc("dashboard_summary", { ...common, p_month: "Baseline" }),
      supabase.rpc("ads_dashboard_summary", {
        p_year: sel.year ? Number(sel.year) : null,
        p_month: sel.month || null,
        p_owner: owner || null,
        p_brand: sel.brand || null,
        p_store: sel.store || null,
      }),
    ]);

    if (curR.error) setErr(`${curR.error.message} (${curR.error.code || "?"})`);
    else setErr("");
    setCur((curR.data as Summary) ?? null);
    setPrev((prevR.data as Summary) ?? null);
    setBaseline((baseR.data as Summary) ?? null);
    setAds((adsR.data as AdsSummary) ?? null);

    // Partial-month guard: a report built from 2 of 4 uploaded weeks would
    // understate the client's month and destroy trust in every number on it.
    if (sel.month && sel.month !== "Baseline" && cid) {
      let q = supabase.from("dashboard_month_completeness")
        .select("week_count").eq("client_id", cid).eq("month", sel.month);
      if (sel.store) q = q.eq("store_name", sel.store);
      const { data: comp } = await q;
      const rows = (comp as { week_count: number }[]) || [];
      setPartialWeeks(rows.length ? Math.min(...rows.map((r) => r.week_count)) : null);
    } else {
      setPartialWeeks(null);
    }

    setLoading(false);
  }, [supabase, sel.year, sel.month, sel.owner, sel.brand, sel.store, prevM]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading && !cur) return <Loader center />;

  const k = cur?.kpis;
  const m = computeMetrics(k);
  const pm = computeMetrics(prev?.kpis);
  const insights = buildInsights({ cur, prev, baseline, ads, lang, prevLabel: prevM });
  const periodLabel = sel.month
    ? `${sel.month}${sel.year ? " " + sel.year : ""}`
    : sel.year ? sel.year : t("All Periods");
  const multiStore = (cur?.dealers || []).filter((d) => d.sales > 0).length > 1;

  // Downloads the same server-rendered A4-landscape deck the Dashboard's Report
  // button produces — this page stays the on-screen preview, but there is
  // only ONE PDF artifact so the two can never drift apart.
  async function handleDownload() {
    setPdfBusy(true);
    try {
      const res = await fetch("/api/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sel, lang }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || "Failed to build the report");
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] || "ProfTokoOnline-Report.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  }

  // Sales series: weekly buckets when a month is selected, monthly otherwise —
  // perf_trend already switches granularity server-side.
  const trend = (cur?.perf_trend || []).map((x) => ({ label: x.bucket, value: x.sales }));

  return (
    <>
      {/* Toolbar — screen only, never printed */}
      <div className="rpt-toolbar no-print">
        <Link href="/" className="rpt-btn-ghost">← {t("Back to Dashboard")}</Link>
        <div style={{ flex: 1 }} />
        {loading && <Loader />}
        <button className="rpt-btn-gold" onClick={handleDownload} disabled={pdfBusy}>
          {pdfBusy ? <>⏳ {t("Building PDF")}…</> : <>⬇ {t("Download PDF")}</>}
        </button>
      </div>

      {err && (
        <div className="no-print" style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", margin: "0 0 14px", color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ {err}
        </div>
      )}

      <div className="rpt" id="rpt-doc">
        {/* ── 1. Cover / scope ── */}
        <header className="rpt-cover">
          <div className="rpt-cover-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="rpt-logo" />
            <div>
              <div className="rpt-brand">Prof Toko Online</div>
              <div className="rpt-brand-sub">{t("Marketplace Performance Report")} — Shopee</div>
            </div>
          </div>
          <h1 className="rpt-title">{periodLabel}</h1>
          <div className="rpt-scope">{scopeLabel(sel, lang, storeLabel)}</div>
          <div className="rpt-meta">
            {clientName && <span>{clientName} · </span>}
            {t("Generated")} {new Date().toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", { day: "2-digit", month: "long", year: "numeric" })}
          </div>
          {partialWeeks != null && partialWeeks < 4 && (
            <div className="rpt-warn">
              ⚠ {lang === "id"
                ? `Bulan ini baru terisi ${partialWeeks} dari 4 minggu. Angka di bawah belum mencerminkan bulan penuh dan perbandingan antar-bulan bisa menyesatkan.`
                : `Only ${partialWeeks} of 4 weeks have been uploaded for this month. The figures below do not yet represent a full month and month-on-month comparisons may mislead.`}
            </div>
          )}
        </header>

        {/* ── 2. Scorecard ── */}
        <Section title={t("Performance Scorecard")}
          sub={prevM ? `${t("Compared with")} ${prevM}` : t("Compared with the starting baseline")}>
          <div className="rpt-kpis">
            <Kpi label={t("Total Sales")} value={idrShort(k?.sales || 0)}
              delta={prev?.kpis ? pctDelta(k?.sales || 0, prev.kpis.sales) : null} />
            <Kpi label={t("Total Transaction")} value={numFmt(k?.transactions || 0)}
              delta={prev?.kpis ? pctDelta(k?.transactions || 0, prev.kpis.transactions) : null} />
            <Kpi label={t("Traffic")} value={numFmt(k?.traffic || 0)}
              delta={prev?.kpis ? pctDelta(k?.traffic || 0, prev.kpis.traffic) : null} />
            <Kpi label={t("Ads Cost")} value={idrShort(k?.ad_cost || 0)}
              delta={prev?.kpis ? pctDelta(k?.ad_cost || 0, prev.kpis.ad_cost) : null} invert />
            <Kpi label={t("ROAS")} value={roasFmt(k?.roas ?? null)}
              delta={prev?.kpis?.roas ? pctDelta(k?.roas || 0, prev.kpis.roas) : null} />
            <Kpi label={t("Conversion Rate")} value={pctFmt(m.convRate, 2)}
              delta={pm.convRate ? pctDelta(m.convRate || 0, pm.convRate) : null} />
          </div>
        </Section>

        {/* ── 3. Sales trend ── */}
        <Section title={t("Sales Trend")}
          sub={sel.month ? t("Weekly within the selected month") : t("Monthly across the selected period")}>
          {trend.length > 0
            ? <Bars data={trend} format={idrShort} />
            : <Empty text={t("No sales data for this selection")} />}
        </Section>

        {/* ── 4. Funnel diagnosis ── */}
        <Section title={t("Customer Funnel")} sub={t("Where visitors are gained and lost")}>
          <Funnel
            steps={[
              { label: t("Traffic"),        value: k?.traffic || 0 },
              { label: t("Product Views"),  value: k?.product_views || 0 },
              { label: t("In-Cart"),        value: k?.in_cart || 0 },
              { label: t("Transactions"),   value: k?.transactions || 0 },
            ]}
          />
          <div className="rpt-metricrow">
            <Metric label={t("Cart Rate")} value={pctFmt(m.cartRate)} hint={t("visitors who add to cart")} />
            <Metric label={t("Cart → Order")} value={pctFmt(m.cartToOrder)} hint={t("carts that become orders")} />
            <Metric label={t("Conversion Rate")} value={pctFmt(m.convRate, 2)} hint={t("visitors who complete an order")} />
          </div>
        </Section>

        {/* ── 5. Ads efficiency ── */}
        <Section title={t("Advertising Efficiency")} sub={t("Return by ad type")}>
          {ads?.totals ? (
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>{t("Ad Type")}</th>
                  <th className="num">{t("Ads Cost")}</th>
                  <th className="num">{t("Sales")}</th>
                  <th className="num">{t("ROAS")}</th>
                  <th className="num">{t("Order")}</th>
                  <th className="num">{t("Share of Spend")}</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["GMV Max Auto", ads.totals.gmv_max],
                  [t("Group Ads"), ads.totals.group_ads],
                  [t("Independent Ads"), ads.totals.independent],
                ] as const).map(([label, v]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num">{idrFull(v?.ads_cost || 0)}</td>
                    <td className="num">{idrFull(v?.sales || 0)}</td>
                    <td className="num strong">{roasFmt(v?.roas ?? null)}</td>
                    <td className="num">{numFmt(v?.orders || 0)}</td>
                    <td className="num">
                      {ads.totals.total.ads_cost > 0
                        ? pctFmt(((v?.ads_cost || 0) / ads.totals.total.ads_cost) * 100, 0)
                        : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="rpt-total">
                  <td>{t("Total")}</td>
                  <td className="num">{idrFull(ads.totals.total.ads_cost)}</td>
                  <td className="num">{idrFull(ads.totals.total.sales)}</td>
                  <td className="num strong">{roasFmt(ads.totals.total.roas)}</td>
                  <td className="num">{numFmt(ads.totals.total.orders)}</td>
                  <td className="num">100%</td>
                </tr>
              </tbody>
            </table>
          ) : <Empty text={t("No ads data for this selection")} />}
        </Section>

        {/* ── 6. Product performance ── */}
        <Section title={t("Product Performance")} sub={t("Top sellers and top advertised products")}>
          <div className="rpt-cols">
            <div>
              <h4 className="rpt-h4">{t("Top Products by Sales")}</h4>
              {(cur?.top_products || []).length > 0 ? (
                <table className="rpt-table sm">
                  <thead><tr><th>#</th><th>{t("Product")}</th><th className="num">{t("Sales")}</th></tr></thead>
                  <tbody>
                    {(cur?.top_products || []).slice(0, 10).map((p, i) => (
                      <tr key={i}>
                        <td className="dim">{i + 1}</td>
                        <td className="clip">{p.name}</td>
                        <td className="num">{idrShort(p.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty text={t("No product data")} />}
            </div>
            <div>
              <h4 className="rpt-h4">{t("Top Advertised Products")}</h4>
              {(ads?.products || []).length > 0 ? (
                <table className="rpt-table sm">
                  <thead><tr><th>{t("Product")}</th><th className="num">{t("Ads Cost")}</th><th className="num">{t("ROAS")}</th></tr></thead>
                  <tbody>
                    {[...(ads?.products || [])]
                      .sort((a, b) => (b.sales || 0) - (a.sales || 0))
                      .slice(0, 10)
                      .map((p) => (
                        <tr key={p.kode_produk}>
                          <td className="clip">{p.nama_produk || p.kode_produk}</td>
                          <td className="num">{idrShort(p.ads_cost)}</td>
                          <td className="num strong">{roasFmt(p.roas)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : <Empty text={t("No advertised product data")} />}
            </div>
          </div>
        </Section>

        {/* ── 8. Store comparison — only meaningful with more than one store ── */}
        {multiStore && (
          <Section title={`${t("Store Comparison")}`} sub={t("Relative contribution and efficiency")}>
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>{t(storeLabel)}</th>
                  <th className="num">{t("Sales")}</th>
                  <th className="num">{t("Traffic")}</th>
                  <th className="num">{t("Order")}</th>
                  <th className="num">{t("Ads Cost")}</th>
                  <th className="num">{t("ROAS")}</th>
                </tr>
              </thead>
              <tbody>
                {[...(cur?.dealers || [])]
                  .filter((d) => d.sales > 0)
                  .sort((a, b) => b.sales - a.sales)
                  .map((d) => (
                    <tr key={d.store_name}>
                      <td>{d.store_name}{d.city ? <span className="dim"> · {d.city}</span> : null}</td>
                      <td className="num">{idrFull(d.sales)}</td>
                      <td className="num">{numFmt(d.traffic)}</td>
                      <td className="num">{numFmt(d.orders)}</td>
                      <td className="num">{idrFull(d.ad_cost)}</td>
                      <td className="num strong">{roasFmt(d.roas)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>
        )}

        {/* ── 9. Findings & recommendations ── */}
        <Section title={t("Findings & Recommendations")} sub={t("Prioritised — most urgent first")}>
          {insights.length > 0
            ? <div className="rpt-insights">{insights.map((x, i) => <InsightCard key={i} ins={x} lang={lang} />)}</div>
            : <Empty text={t("Not enough data to generate findings for this selection")} />}
        </Section>

        <footer className="rpt-footer">
          Prof Toko Online · {scopeLabel(sel, lang, storeLabel)} · {periodLabel}
        </footer>
      </div>
    </>
  );
}

/* ── Building blocks ─────────────────────────────────────────────────── */

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rpt-section">
      <h2 className="rpt-h2">{title}</h2>
      {sub && <div className="rpt-sub">{sub}</div>}
      {children}
    </section>
  );
}

function Kpi({ label, value, delta, invert }: { label: string; value: string; delta: number | null; invert?: boolean }) {
  // `invert` flips the colour logic for cost-style metrics, where up is bad.
  const good = delta == null ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className="rpt-kpi">
      <div className="rpt-kpi-label">{label}</div>
      <div className="rpt-kpi-value">{value}</div>
      {delta != null && Number.isFinite(delta) && (
        <div className={`rpt-kpi-delta ${good ? "up" : "down"}`}>
          {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rpt-metric">
      <div className="rpt-metric-value">{value}</div>
      <div className="rpt-metric-label">{label}</div>
      <div className="rpt-metric-hint">{hint}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rpt-empty">{text}</div>;
}

/** Vertical bars. Hand-rolled SVG rather than recharts: fixed width prints
 *  deterministically, where ResponsiveContainer collapses to 0 in print. */
function Bars({ data, format }: { data: { label: string; value: number }[]; format: (n: number) => string }) {
  const H = 190, PAD_B = 30, PAD_T = 18;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = Math.max(6, Math.min(56, (CHART_W - 20) / data.length - 10));
  const step = data.length ? (CHART_W - 20) / data.length : 0;
  return (
    <svg width={CHART_W} height={H} className="rpt-chart" role="img">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={0} x2={CHART_W} y1={PAD_T + (H - PAD_T - PAD_B) * (1 - g)} y2={PAD_T + (H - PAD_T - PAD_B) * (1 - g)}
          stroke="#e5e7eb" strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const h = Math.max(1, ((H - PAD_T - PAD_B) * d.value) / max);
        const x = 10 + i * step + (step - bw) / 2;
        const y = H - PAD_B - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill="#c9a227" rx={2} />
            <text x={x + bw / 2} y={y - 5} textAnchor="middle" fontSize={9} fill="#6b7280">{format(d.value)}</text>
            <text x={x + bw / 2} y={H - PAD_B + 14} textAnchor="middle" fontSize={9} fill="#6b7280">
              {d.label.length > 9 ? d.label.slice(0, 8) + "…" : d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal funnel — each step's width is its share of the first step, with
 *  the step-to-step drop-off called out explicitly (that's the diagnosis). */
function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = steps[0]?.value || 0;
  return (
    <div className="rpt-funnel">
      {steps.map((s, i) => {
        const pct = top > 0 ? (s.value / top) * 100 : 0;
        const prevV = i > 0 ? steps[i - 1].value : null;
        const drop = prevV && prevV > 0 ? ((prevV - s.value) / prevV) * 100 : null;
        return (
          <div key={s.label} className="rpt-funnel-row">
            <div className="rpt-funnel-label">{s.label}</div>
            <div className="rpt-funnel-track">
              <div className="rpt-funnel-fill" style={{ width: `${Math.max(pct, 1)}%` }} />
              <span className="rpt-funnel-val">{numFmt(s.value)}</span>
            </div>
            <div className="rpt-funnel-pct">
              {pct.toFixed(1)}%
              {drop != null && drop > 0 && <span className="rpt-funnel-drop"> −{drop.toFixed(0)}%</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InsightCard({ ins, lang }: { ins: Insight; lang: Lang }) {
  const icon = ins.severity === "bad" ? "!" : ins.severity === "warn" ? "▲" : "✓";
  return (
    <div className={`rpt-insight ${ins.severity}`}>
      <div className="rpt-insight-icon">{icon}</div>
      <div>
        <div className="rpt-insight-title">{ins.title}</div>
        <div className="rpt-insight-detail">{ins.detail}</div>
        {ins.action && (
          <div className="rpt-insight-action">
            <strong>{lang === "id" ? "Tindakan" : "Action"}:</strong> {ins.action}
          </div>
        )}
      </div>
    </div>
  );
}
