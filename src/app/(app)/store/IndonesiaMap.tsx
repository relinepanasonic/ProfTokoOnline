"use client";

import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";

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

type Feat = { type: "Feature"; properties: { name: string | null }; geometry: Geometry };
let cachedGeo: FeatureCollection<Geometry, { name: string | null }> | null = null;

export default function IndonesiaMap({ data }: { data: { province: string; gmv: number }[] }) {
  const [geo, setGeo] = useState(cachedGeo);
  const [hover, setHover] = useState<{ name: string; gmv: number; x: number; y: number } | null>(null);

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

  const gmvByProvince = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data) {
      const key = normalize(d.province);
      m.set(key, (m.get(key) || 0) + d.gmv);
    }
    return m;
  }, [data]);

  const max = Math.max(1, ...Array.from(gmvByProvince.values()));
  const W = 460, H = 260;
  const projection = useMemo(() => (geo ? geoMercator().fitSize([W, H], geo) : null), [geo]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);

  if (!geo || !path) {
    return <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>Memuat peta…</div>;
  }

  return (
    <div style={{ position: "relative", maxWidth: 520, margin: "0 auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {(geo.features as Feat[]).map((f, i) => {
          const name = f.properties?.name ?? null;
          const gmv = name ? gmvByProvince.get(name) ?? 0 : 0;
          const t = gmv / max;
          const fill = gmv > 0 ? `rgba(201,162,39,${(0.15 + t * 0.75).toFixed(2)})` : "rgba(255,255,255,0.045)";
          // Higher-GMV provinces get a soft gold glow, intensity scaled to their share of the max.
          const glow = t > 0.04 ? `drop-shadow(0 0 ${(3 + t * 9).toFixed(1)}px rgba(240,208,112,${(0.35 + t * 0.55).toFixed(2)}))` : "none";
          return (
            <path key={i} d={path(f) || undefined} fill={fill} stroke="rgba(6,14,33,0.75)" strokeWidth={0.6}
              style={{ filter: glow, transition: "filter .2s" }}
              onMouseMove={(e) => name && setHover({ name, gmv, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHover(null)} />
          );
        })}
      </svg>
      {hover && (
        <div style={{ position: "fixed", left: hover.x + 14, top: hover.y + 10, background: "rgba(6,14,33,0.97)", border: "1px solid rgba(201,162,39,0.35)", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#e8edf8", pointerEvents: "none", zIndex: 30 }}>
          <div style={{ fontWeight: 700 }}>{hover.name}</div>
          <div>{rpC(hover.gmv)}</div>
        </div>
      )}
    </div>
  );
}
