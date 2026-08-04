"use client";

// Same table as StoreSalesTable ("Store Data per <Store>") — identical
// header/columns — but scoped to the Baseline (Month Awal) snapshot instead
// of real months. dashboard_summary()'s f_real CTE excludes Baseline unless
// p_month='Baseline' is passed explicitly, so this is the same RPC with that
// one parameter flipped. No sparkline/trend: Baseline is a single point, not
// a series, and dashboard_month_completeness (which trend_by_store joins on)
// deliberately never counts Baseline weeks.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";

type Dealer = {
  store_name: string; city: string; sales: number; traffic: number; in_cart: number;
  orders: number; ad_cost: number; roas: number | null;
};

const idr = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));

export default function BaselineDealerTable() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [storeLabel, setStoreLabel] = useState("Store");
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
        p_year: null, p_month: "Baseline", p_city: null, p_owner: null, p_brand: null, p_store: null,
      });
      setDealers((data?.dealers as Dealer[]) || []);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3>{t("Baseline Dealer")}</h3>
      <div className="hint">{t("Month Awal snapshot per")} {t(storeLabel)}</div>
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
              return (
                <tr key={i}>
                  <td>{r.store_name}</td>
                  <td>—</td>
                  <td className="num">{idr(r.sales)}</td>
                  <td className="num">{num(r.traffic)}</td>
                  <td className="num">{num(r.in_cart)}</td>
                  <td className="num">{cr.toFixed(1)}%</td>
                  <td className="num">{idr(r.ad_cost)}</td>
                  <td className="num">—</td>
                  <td className="num">
                    <span className={`pill ${!r.roas ? "" : r.roas >= 3 ? "good" : r.roas >= 1 ? "warn" : "bad"}`}>
                      {r.roas ? r.roas.toFixed(2) + "×" : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!dealers.length && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{loading ? "…" : t("No Baseline data yet")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
