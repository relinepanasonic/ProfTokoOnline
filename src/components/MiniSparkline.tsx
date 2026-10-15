"use client";

import { useId } from "react";

// Smooth (Catmull-Rom -> cubic Bezier) line through the given points.
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

/**
 * Tiny line chart for a KPI card — the same look as the Dashboard / Earning cards:
 * a smooth line with a gradient that glows down to the bottom edge.
 */
export default function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const gid = "spk-" + useId().replace(/[^a-zA-Z0-9]/g, "");
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
