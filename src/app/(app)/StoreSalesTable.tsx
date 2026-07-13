"use client";

// Same table + data source as the Dashboard's "Store Data per <Store>"
// (dashboard_summary().dealers, unfiltered) — embedded here so an uploader
// can immediately verify real sales/traffic/ROAS landed correctly, without
// leaving the Upload page. Self-contained: fetches its own data rather than
// threading it through from the Dashboard, since this page has no reason to
// otherwise call dashboard_summary().
import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";

const StoreDrillDown = dynamicImport(() => import("./DashboardCharts").then((m) => m.StoreDrillDown), { ssr: false });

type Dealer = {
  store_name: string; city: string; sales: number; traffic: number; in_cart: number;
  orders: number; ad_cost: number; roas: number | null;
  trend?: { month: string; sales: number; ad_cost: number | null }[];
};

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

function Sparkline({ data }: { data?: { month: string; value: number }[] }) {
  const pts = (data || []).filter((p) => p.value != null);
  if (pts.length < 2) return null;

  const W = 96, H = 40, PADX = 4, PADY = 6;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = (W - PADX * 2) / (pts.length - 1);
  const coords = vals.map((v, i) => {
    const x = PADX + i * stepX;
    const y = H - PADY - ((v - min) / range) * (H - PADY * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z`;

  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? "#22c55e" : "#ef4444";
  const pctChange = vals[0] ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0;
  const [lastX, lastY] = coords[coords.length - 1];
  const gid = `spk-${Math.round(coords[0][1]) + Math.round(lastX)}-${up ? "u" : "d"}`;

  return (
    <span title={`${up ? "▲" : "▼"} ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}% vs first period`}
      style={{ display: "inline-flex", alignItems: "center" }}>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id={`${gid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={color} floodOpacity="0.7" />
          </filter>
        </defs>
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />
        <circle cx={lastX} cy={lastY} r={2.6} fill={color} />
      </svg>
    </span>
  );
}

export default function StoreSalesTable() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [storeLabel, setStoreLabel] = useState("Store");
  const [drillStore, setDrillStore] = useState<Dealer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: p } = await supabase.from("profiles").select("client_id").eq("id", user.id).single();
      if (p?.client_id) {
        const { data: c } = await supabase.from("clients").select("store_label").eq("id", p.client_id).single();
        if (c?.store_label) setStoreLabel(c.store_label);
      }
      const { data } = await supabase.rpc("dashboard_summary", {
        p_year: null, p_month: null, p_city: null, p_owner: null, p_brand: null, p_store: null,
      });
      setDealers((data?.dealers as Dealer[]) || []);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3>{t("Store Data per")} {t(storeLabel)}</h3>
      <div className="hint">{t("Sorted by sales · Baseline excluded · line shows SPOS sales trend")} · {t("Click row for details")}</div>
      <div className="tbl-wrap" style={{ maxHeight: 440 }}>
        <table className="tbl">
          <thead><tr>
            <th>{t(storeLabel)}</th><th>{t("Trend")}</th>
            <th className="num">{t("Sales")}</th><th className="num">{t("Traffic")}</th>
            <th className="num">{t("In-Cart")}</th><th className="num">{t("Cart Rate")}</th>
            <th className="num">{t("Ads Cost")}</th><th className="num">{t("ROAS Trend")}</th><th className="num">{t("ROAS")}</th>
          </tr></thead>
          <tbody>
            {dealers.map((r, i) => {
              const cr = r.traffic ? (r.in_cart / r.traffic) * 100 : 0;
              const roasTrend = r.trend?.map((tr) => ({ month: tr.month, value: tr.ad_cost ? tr.sales / tr.ad_cost : 0 }));
              return (
                <tr key={i} style={{ cursor: "pointer" }} onClick={() => setDrillStore(r)}>
                  <td>{r.store_name}</td>
                  <td><Sparkline data={r.trend?.map((tr) => ({ month: tr.month, value: tr.sales }))} /></td>
                  <td className="num">{idr(r.sales)}</td>
                  <td className="num">{num(r.traffic)}</td>
                  <td className="num">{num(r.in_cart)}</td>
                  <td className="num">{cr.toFixed(1)}%</td>
                  <td className="num">{idr(r.ad_cost)}</td>
                  <td className="num"><Sparkline data={roasTrend} /></td>
                  <td className="num">
                    <span className={`pill ${!r.roas ? "" : r.roas >= 3 ? "good" : r.roas >= 1 ? "warn" : "bad"}`}>
                      {r.roas ? r.roas.toFixed(2) + "×" : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!dealers.length && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{loading ? "…" : t("No data yet")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {drillStore && (
        <StoreDrillDown store={drillStore} storeLabel={t(storeLabel)} t={t} onClose={() => setDrillStore(null)} />
      )}
    </div>
  );
}
