"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { useLang } from "@/lib/i18n";

// Province-level topology (33 provinces, ~2010s boundaries — predates
// Indonesia's 2022 Papua split into 6 provinces). Good enough for a
// GMV heatmap: the overwhelming majority of Shopee orders fall in the
// long-established provinces (Java, Sumatra, etc.), which map exactly.
const TOPO_URL = "https://cdn.jsdelivr.net/npm/datamaps@0.5.10/src/js/data/idn.topo.json";

// Normalizes the ALL-CAPS Indonesian province names from Shopee's export to
// this topology's naming (verified against the topology's own name list).
const PROVINCE_ALIAS: Record<string, string> = {
  "DKI JAKARTA": "Jakarta Raya",
  "DI YOGYAKARTA": "Yogyakarta",
  "KEPULAUAN BANGKA BELITUNG": "Bangka-Belitung",
  "BANGKA BELITUNG": "Bangka-Belitung",
  "PAPUA BARAT": "Irian Jaya Barat",
  "PAPUA BARAT DAYA": "Irian Jaya Barat",
  "PAPUA TENGAH": "Papua",
  "PAPUA PEGUNUNGAN": "Papua",
  "PAPUA SELATAN": "Papua",
};
function normalize(p: string): string {
  const up = p.trim().toUpperCase();
  if (PROVINCE_ALIAS[up]) return PROVINCE_ALIAS[up];
  return up.split(" ").map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
}
const rpC = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "Rp " + (n / 1e9).toFixed(1) + "M";
  if (a >= 1e6) return "Rp " + (n / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return "Rp " + Math.round(n / 1e3) + "rb";
  return "Rp " + Math.round(n);
};
const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const numFull = (n: number) => Math.round(n || 0).toLocaleString("id-ID");
const fmtSla = (d: number | null) => d == null ? "—" : `${d.toFixed(1)} hari`;

type ProvinceStat = { province: string; gmv: number; transactions: number; product_sold: number };
export type CityDetailRow = {
  city: string; province: string; gmv: number; transactions: number;
  product_sold: number; sla_days: number | null; cancellations: number; returns: number;
};
type Feat = { type: "Feature"; properties: { name: string | null }; geometry: Geometry };
let cachedGeo: FeatureCollection<Geometry, { name: string | null }> | null = null;

type SortKey = "city" | "gmv" | "transactions" | "product_sold" | "sla_days" | "cancellations" | "returns";

export default function IndonesiaMap({ data, cityDetail }: { data: ProvinceStat[]; cityDetail: CityDetailRow[] }) {
  const { t } = useLang();
  const [geo, setGeo] = useState(cachedGeo);
  const [hover, setHover] = useState<{ name: string; stat: ProvinceStat | null; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<{ name: string; rows: CityDetailRow[] } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("transactions");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function selectProvince(name: string, rows: CityDetailRow[]) {
    setSelected({ name, rows });
    setSortKey("transactions");
    setSortDir("desc");
  }
  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "city" ? "asc" : "desc"); }
  }
  const arrow = (k: SortKey) => sortKey !== k ? "" : sortDir === "asc" ? " ▲" : " ▼";
  const sortedRows = useMemo(() => {
    if (!selected) return [];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...selected.rows].sort((a, b) => {
      if (sortKey === "city") return a.city.localeCompare(b.city) * dir;
      const av = a[sortKey] ?? -Infinity, bv = b[sortKey] ?? -Infinity;
      return (av - bv) * dir;
    });
  }, [selected, sortKey, sortDir]);

  useEffect(() => {
    if (cachedGeo) return;
    fetch(TOPO_URL)
      .then((r) => r.json())
      .then((topo: Topology) => {
        const fc = feature(topo, topo.objects.idn) as unknown as FeatureCollection<Geometry, { name: string | null }>;
        cachedGeo = fc;
        setGeo(fc);
      })
      .catch(() => {});
  }, []);

  const statsByProvince = useMemo(() => {
    const m = new Map<string, ProvinceStat>();
    for (const d of data) {
      const key = normalize(d.province);
      const cur = m.get(key) || { province: key, gmv: 0, transactions: 0, product_sold: 0 };
      m.set(key, {
        province: key,
        gmv: cur.gmv + (d.gmv || 0),
        transactions: cur.transactions + (d.transactions || 0),
        product_sold: cur.product_sold + (d.product_sold || 0),
      });
    }
    return m;
  }, [data]);

  const cityByProvince = useMemo(() => {
    const m = new Map<string, CityDetailRow[]>();
    for (const c of cityDetail) {
      const key = normalize(c.province);
      const arr = m.get(key) || [];
      arr.push(c);
      m.set(key, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.city.localeCompare(b.city));
    return m;
  }, [cityDetail]);

  const max = Math.max(1, ...Array.from(statsByProvince.values()).map((s) => s.gmv));
  const W = 460, H = 260;
  const projection = useMemo(() => (geo ? geoMercator().fitSize([W, H], geo) : null), [geo]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  if (!geo || !path) {
    return <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>{t("Loading map…")}</div>;
  }

  return (
    <div style={{ position: "relative", maxWidth: 520, margin: "0 auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {(geo.features as Feat[]).map((f, i) => {
          const name = f.properties?.name ?? null;
          const stat = name ? statsByProvince.get(name) ?? null : null;
          const gmv = stat?.gmv ?? 0;
          const tt = gmv / max;
          const fill = gmv > 0 ? `rgba(201,162,39,${(0.15 + tt * 0.75).toFixed(2)})` : "rgba(255,255,255,0.045)";
          // Higher-GMV provinces get a soft gold glow, intensity scaled to their share of the max.
          const glow = tt > 0.04 ? `drop-shadow(0 0 ${(3 + tt * 9).toFixed(1)}px rgba(240,208,112,${(0.35 + tt * 0.55).toFixed(2)}))` : "none";
          return (
            <path key={i} d={path(f) || undefined} fill={fill} stroke="rgba(6,14,33,0.75)" strokeWidth={0.6}
              style={{ filter: glow, transition: "filter .2s", cursor: name ? "pointer" : "default" }}
              onMouseMove={(e) => name && setHover({ name, stat, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)}
              onClick={() => name && selectProvince(name, cityByProvince.get(name) || [])} />
          );
        })}
      </svg>
      {/* Portaled to document.body — this map sits inside a .panel with
          backdrop-filter, and any backdrop-filter ancestor turns descendant
          position:fixed elements into being positioned relative to THAT
          ancestor instead of the real viewport (see panel-clips-modals).
          That made the tooltip land far from the cursor and the drill-down
          "modal" render clipped to the panel instead of covering the screen. */}
      {hover && createPortal(
        <div style={{ position: "fixed", left: hover.x + 14, top: hover.y + 10, background: "rgba(6,14,33,0.97)", border: "1px solid rgba(201,162,39,0.35)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#e8edf8", pointerEvents: "none", zIndex: 9500 }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>{hover.name}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <span>GMV: <b style={{ color: "var(--gold)" }}>{rpC(hover.stat?.gmv ?? 0)}</b></span>
            <span>{t("Transaction")}: <b>{numFull(hover.stat?.transactions ?? 0)}</b></span>
            <span>{t("Total Product Sold")}: <b>{numFull(hover.stat?.product_sold ?? 0)}</b></span>
          </div>
        </div>,
        document.body
      )}

      {selected && createPortal(
        <div style={overlay} onClick={() => setSelected(null)}>
          <div style={drawer} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{t("Province Detail")} — {selected.name}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{t("Click a province to see its city/regency breakdown")}</div>
              </div>
              <button className="btn-ghost" onClick={() => setSelected(null)}>✕ {t("Close")}</button>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: "72vh" }}>
              <table className="tbl" style={{ color: "#e8edf8", fontSize: 13.5 }}>
                <thead><tr>
                  <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("city")}>{t("City / Regency")}{arrow("city")}</th>
                  <th className="num" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("gmv")}>{t("Sales")}{arrow("gmv")}</th>
                  <th className="num" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("transactions")}>{t("Total Transaction")}{arrow("transactions")}</th>
                  <th className="num" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("product_sold")}>{t("Total Product Sold")}{arrow("product_sold")}</th>
                  <th className="num" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("sla_days")}>SLA{arrow("sla_days")}</th>
                  <th className="num" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("cancellations")}>{t("Total Cancellations")}{arrow("cancellations")}</th>
                  <th className="num" style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("returns")}>{t("Total Returned Products")}{arrow("returns")}</th>
                </tr></thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.city}>
                      <td style={{ fontWeight: 600 }}>{r.city}</td>
                      <td className="num">{rpFull(r.gmv)}</td>
                      <td className="num">{numFull(r.transactions)}</td>
                      <td className="num">{numFull(r.product_sold)}</td>
                      <td className="num">{fmtSla(r.sla_days)}</td>
                      <td className="num">{numFull(r.cancellations)}</td>
                      <td className="num">{numFull(r.returns)}</td>
                    </tr>
                  ))}
                  {sortedRows.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>{t("No data for this province")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const drawer: React.CSSProperties = { width: "min(98vw,1100px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 28, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
