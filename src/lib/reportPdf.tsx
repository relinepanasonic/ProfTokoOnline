import {
  Document, Page, View, Text, StyleSheet, Svg, Rect, Path, Circle,
  Line as SvgLine, Polyline, Font,
} from "@react-pdf/renderer";
import { Fragment } from "react";
import {
  buildInsights, computeMetrics, pctDelta,
  idrFull, idrShort, numFmt, pctFmt, roasFmt,
  type Summary, type AdsSummary, type Kpis, type Lang,
} from "@/lib/reportInsights";

// =====================================================================
// Profesor Toko Online — client performance report, as a landscape 16:9
// slide deck rendered server-side with @react-pdf/renderer.
//
// Page is a fixed 960x540pt (exactly 16:9, the PowerPoint widescreen
// size). Every block has an explicit height out of the BODY_H budget so
// content can never reflow past the margin onto a phantom second page.
// (wrap={false} would ALSO prevent that, but it makes react-pdf shrink
// the page down to its content height, silently breaking the ratio.)
//
// Numbers/insights come from lib/reportInsights — the SAME module the
// on-screen report and the dashboard use — so the deck can never drift
// from what the client sees in the app. No aggregation happens here.
//
// Fonts: react-pdf's built-in Helvetica. This deck is EN/ID only (Latin),
// so there's no reason to bundle a webfont — but note the built-ins are
// WinAnsi-encoded, so any glyph outside CP1252 renders as tofu. "×" and
// "—" are in WinAnsi and safe; "→" and "▲/▼" are NOT, so arrows use "->"
// and deltas use ASCII +/- markers.
// =====================================================================

const F_REG = "Helvetica";
const F_BOLD = "Helvetica-Bold";

// react-pdf hyphenates long words by default, which breaks product codes
// like "CS/CU-YN18AKJ" mid-token. Return the word unsplit.
Font.registerHyphenationCallback((w) => [w]);

/* ---------------- palette ---------------- */
const NAVY = "#172c54";
const NAVY_DEEP = "#122344";
const GOLD = "#c9a227";
const GOLD_SOFT = "#d8b551";
const BG = "#f4f6fa";
const WHITE = "#ffffff";
const INK = "#1c2434";
const MUTED = "#6b7688";
const BORDER = "#e2e6ee";
const GREEN = "#1f9254";
const RED = "#c0392b";

/* ---------------- page geometry ---------------- */
const PAGE_W = 960;
const PAGE_H = 540;
// Object form + an explicit height in the page style: with the array form
// react-pdf auto-shrinks each page down to its content height, which
// silently breaks the 16:9 ratio.
const PAGE_SIZE = { width: PAGE_W, height: PAGE_H };
const PAD = 38;
const CONTENT_W = PAGE_W - PAD * 2;          // 884
const HEADER_H = 52;
const FOOTER_H = 18;
const COL2 = (CONTENT_W - 14) / 2;            // 435
const COL3 = (CONTENT_W - 28) / 3;            // 285.33

const BRAND = "Profesor Toko Online";
const TAGLINE = "STOP BONCOS, MULAI CUAN";

/* ---------------- i18n (this deck only) ---------------- */
const T = {
  en: {
    reportLine: "MONTHLY PERFORMANCE REPORT",
    client: "Client", preparedFor: "Prepared for", store: "Store",
    generated: "Generated", allStores: "All Stores", allPeriods: "All Periods",
    summary: "SUMMARY",
    sec1: "Executive Summary", sec2: "Program Impact — Baseline vs Now",
    sec3: "Trends & Composition", sec4: "Advertising Efficiency",
    sec5: "Store Performance", sec6: "Top 10 Best-Selling Products",
    sec7: "Findings & Next Steps",
    kSales: "TOTAL SALES", kSalesSub: "Ready to ship",
    kTraffic: "TRAFFIC", kTrafficSub: "Product visitors",
    kCart: "ADDED TO CART", kCartSub: "ATC rate {pct}",
    kAds: "AD SPEND", kAdsSub: "Across all ad types",
    kRoas: "ROAS — SALES / SPEND", kRoasSub: "From {rp} ad spend",
    kConv: "CONVERSION RATE", kConvSub: "Visitors who order",
    salesTitle: "Sales Performance", salesSub: "Last {n} periods",
    costRoasTitle: "Ad Spend & ROAS", costRoasSub: "Spend vs efficiency — last {n} periods",
    funnelTitle: "Conversion Funnel", funnelSub: "Traffic to order — {period}",
    shareTitle: "Brand Share", shareSub: "Top brand vs others (revenue)",
    fTraffic: "Traffic", fViews: "Views", fCart: "Cart", fOrders: "Orders",
    cartNote: "({pct} of traffic)",
    legendOther: "Other brands — {v}",
    adType: "AD TYPE", adCost: "AD SPEND", adSales: "SALES", adRoas: "ROAS",
    adOrders: "ORDER", adShare: "SHARE OF SPEND", adTotal: "Total",
    gmvMax: "GMV Max Auto", groupAds: "Group Ads", indepAds: "Independent Ads",
    no: "#", storeCol: "STORE", city: "CITY", sales: "SALES",
    traffic: "TRAFFIC", cart: "CART",
    product: "PRODUCT", pctOfTop: "% OF TOP 10",
    noStores: "No store data for this selection.",
    noProducts: "No product data for this selection.",
    noAds: "No ads data for this selection.",
    noInsights: "Not enough data to generate findings for this selection.",
    overflow: "+{n} more stores — {v} total sales",
    baselineNone: "No baseline recorded yet",
    baselineNoneNote: "Once a \"Baseline\" month is uploaded for this scope, this page compares it against the current period.",
    bMetric: "METRIC", bBefore: "BASELINE", bAfter: "NOW", bChange: "CHANGE",
    bSales: "Sales", bAds: "Ad spend", bTraffic: "Traffic", bRoas: "ROAS",
    bBigSales: "Sales", bBigTraffic: "Traffic", bRoasNow: "ROAS NOW",
    bRoasBefore: "Baseline {v}", bNoAdsBefore: "No managed ads at baseline",
    bDetail: "BASELINE VS NOW BREAKDOWN",
    bFootnote: "\"Baseline\" is the pre-project snapshot uploaded as the Baseline month for this scope; \"Now\" is the selected period. Both are totals for the selected Owner / Brand / Store, not per-store averages.",
    actions: "RECOMMENDED ACTIONS — NEXT PERIOD",
    chartEmpty: "No data for this selection",
    partial: "Only {n} of 4 weeks uploaded for this month — figures do not yet represent a full month.",
    good: "WIN", warn: "WATCH", bad: "ACTION NEEDED",
  },
  id: {
    reportLine: "LAPORAN PERFORMA BULANAN",
    client: "Klien", preparedFor: "Disiapkan untuk", store: "Toko",
    generated: "Dibuat", allStores: "Semua Toko", allPeriods: "Semua Periode",
    summary: "RINGKASAN",
    sec1: "Ringkasan Eksekutif", sec2: "Dampak Program — Baseline vs Sekarang",
    sec3: "Tren & Komposisi", sec4: "Efisiensi Iklan",
    sec5: "Performa Toko", sec6: "10 Produk Terlaris",
    sec7: "Temuan & Langkah Berikutnya",
    kSales: "TOTAL PENJUALAN", kSalesSub: "Siap dikirim",
    kTraffic: "TRAFFIC", kTrafficSub: "Pengunjung produk",
    kCart: "MASUK KERANJANG", kCartSub: "Rasio ATC {pct}",
    kAds: "BIAYA IKLAN", kAdsSub: "Seluruh jenis iklan",
    kRoas: "ROAS — PENJUALAN / IKLAN", kRoasSub: "Dari biaya iklan {rp}",
    kConv: "CONVERSION RATE", kConvSub: "Pengunjung yang order",
    salesTitle: "Performa Penjualan", salesSub: "{n} periode terakhir",
    costRoasTitle: "Biaya Iklan & ROAS", costRoasSub: "Biaya vs efisiensi — {n} periode terakhir",
    funnelTitle: "Funnel Konversi", funnelSub: "Traffic ke order — {period}",
    shareTitle: "Pangsa Brand", shareSub: "Brand teratas vs lainnya (omzet)",
    fTraffic: "Traffic", fViews: "Dilihat", fCart: "Keranjang", fOrders: "Order",
    cartNote: "({pct} dari traffic)",
    legendOther: "Brand lain — {v}",
    adType: "JENIS IKLAN", adCost: "BIAYA IKLAN", adSales: "PENJUALAN", adRoas: "ROAS",
    adOrders: "ORDER", adShare: "PORSI BIAYA", adTotal: "Total",
    gmvMax: "GMV Max Auto", groupAds: "Iklan Grup", indepAds: "Iklan Mandiri",
    no: "#", storeCol: "TOKO", city: "KOTA", sales: "PENJUALAN",
    traffic: "TRAFFIC", cart: "KERANJANG",
    product: "PRODUK", pctOfTop: "% DARI TOP 10",
    noStores: "Tidak ada data toko untuk pilihan ini.",
    noProducts: "Tidak ada data produk untuk pilihan ini.",
    noAds: "Tidak ada data iklan untuk pilihan ini.",
    noInsights: "Data belum cukup untuk menghasilkan temuan pada pilihan ini.",
    overflow: "+{n} toko lainnya — total penjualan {v}",
    baselineNone: "Baseline belum tersedia",
    baselineNoneNote: "Setelah bulan \"Baseline\" diunggah untuk cakupan ini, halaman ini akan membandingkannya dengan periode berjalan.",
    bMetric: "METRIK", bBefore: "BASELINE", bAfter: "SEKARANG", bChange: "PERUBAHAN",
    bSales: "Penjualan", bAds: "Biaya iklan", bTraffic: "Traffic", bRoas: "ROAS",
    bBigSales: "Penjualan", bBigTraffic: "Traffic", bRoasNow: "ROAS SEKARANG",
    bRoasBefore: "Baseline {v}", bNoAdsBefore: "Belum ada iklan terkelola saat baseline",
    bDetail: "RINCIAN BASELINE VS SEKARANG",
    bFootnote: "\"Baseline\" adalah snapshot sebelum program yang diunggah sebagai bulan Baseline untuk cakupan ini; \"Sekarang\" adalah periode yang dipilih. Keduanya total untuk Owner / Brand / Toko terpilih, bukan rata-rata per toko.",
    actions: "REKOMENDASI TINDAKAN — PERIODE BERIKUTNYA",
    chartEmpty: "Tidak ada data untuk pilihan ini",
    partial: "Baru {n} dari 4 minggu terunggah untuk bulan ini — angka belum mencerminkan satu bulan penuh.",
    good: "WIN", warn: "PERHATIAN", bad: "PERLU TINDAKAN",
  },
} as const;

const tf = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));

/* ---------------- formatting ---------------- */
const mult = (n: number) => n.toFixed(1).replace(".", ",") + "x";
// Base-14 fonts have no ▲/▼ glyph — ASCII markers keep spacing intact.
const deltaStr = (p: number | null, lang: Lang) =>
  p == null ? "—" : (p >= 0 ? "+" : "-") + pctFmt(Math.abs(p)) + (lang === "id" ? " vs lalu" : " MoM");
const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || "");

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const MONTH_SHORT: Record<string, string> = {
  Januari: "Jan", Februari: "Feb", Febuari: "Feb", Maret: "Mar", April: "Apr", Mei: "Mei", Juni: "Jun",
  Juli: "Jul", Agustus: "Agu", September: "Sep", Oktober: "Okt", November: "Nov", Desember: "Des",
};
/** Chronological order, dropping Baseline / "Month Awal" style buckets. */
export function lastN<T extends { month: string }>(pts: T[], n: number): T[] {
  return [...(pts || [])]
    .filter((p) => p.month && !/awal|baseline/i.test(p.month))
    .sort((a, b) => MONTHS.indexOf(a.month) - MONTHS.indexOf(b.month))
    .slice(-n);
}

/* ---------------- styles ---------------- */
const s = StyleSheet.create({
  page: { width: PAGE_W, height: PAGE_H, backgroundColor: BG, paddingTop: PAD, paddingBottom: PAD, paddingHorizontal: PAD, fontFamily: F_REG, color: INK },
  secNo: { fontFamily: F_BOLD, fontSize: 13, color: GOLD, marginRight: 9 },
  secTitle: { fontFamily: F_BOLD, fontSize: 21, color: NAVY },
  rule: { height: 1, backgroundColor: BORDER, marginTop: 11 },
  card: { backgroundColor: WHITE, borderRadius: 7, borderWidth: 1, borderColor: BORDER, padding: 12 },
  cardTitle: { fontFamily: F_BOLD, fontSize: 12.5, color: NAVY },
  cardSub: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  label: { fontSize: 7, color: MUTED, fontFamily: F_BOLD, letterSpacing: 0.5 },
  footer: { position: "absolute", left: PAD, right: PAD, bottom: 16, flexDirection: "row", justifyContent: "space-between" },
  footTxt: { fontSize: 7, color: MUTED },
  th: { fontSize: 7, color: MUTED, fontFamily: F_BOLD, letterSpacing: 0.4 },
  td: { fontSize: 8.5, color: INK },
});

/* ---------------- chart primitives (plain SVG, no browser) ---------------- */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / mag) * mag;
}

function Empty({ w, h, lang }: { w: number; h: number; lang: Lang }) {
  return (
    <Svg width={w} height={h}>
      <Text x={w / 2} y={h / 2} style={{ fontSize: 8, fill: MUTED, textAnchor: "middle" } as never}>{T[lang].chartEmpty}</Text>
    </Svg>
  );
}

function BarsSvg({ data, w, h, lang }: { data: { label: string; value: number }[]; w: number; h: number; lang: Lang }) {
  if (!data.length) return <Empty w={w} h={h} lang={lang} />;
  const padL = 52, padR = 8, padT = 16, padB = 18;
  const cw = w - padL - padR, ch = h - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const gap = Math.min(14, cw / (data.length * 4));
  const bw = (cw - gap * (data.length - 1)) / data.length;
  return (
    <Svg width={w} height={h}>
      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
        <Fragment key={i}>
          <SvgLine x1={padL} y1={padT + ch - t * ch} x2={w - padR} y2={padT + ch - t * ch} stroke={i === 0 ? "#cfd6e2" : "#eef1f6"} strokeWidth={1} />
          <Text x={padL - 5} y={padT + ch - t * ch + 3} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "end" } as never}>{idrShort(max * t)}</Text>
        </Fragment>
      ))}
      {data.map((d, i) => {
        const bh = Math.max((d.value / max) * ch, 1);
        const x = padL + i * (bw + gap);
        const y = padT + ch - bh;
        const on = i === data.length - 1;
        return (
          <Fragment key={i}>
            <Rect x={x} y={y} width={bw} height={bh} fill={on ? GOLD : NAVY} rx={2} />
            <Text x={x + bw / 2} y={y - 4} style={{ fontSize: 7, fill: on ? GOLD : NAVY, textAnchor: "middle", fontFamily: F_BOLD } as never}>
              {idrShort(d.value).replace("Rp ", "").replace("Rp", "")}
            </Text>
            <Text x={x + bw / 2} y={padT + ch + 11} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "middle" } as never}>{d.label}</Text>
          </Fragment>
        );
      })}
    </Svg>
  );
}

function CostRoasSvg({ data, w, h, lang }: { data: { label: string; cost: number; roas: number | null }[]; w: number; h: number; lang: Lang }) {
  if (!data.length) return <Empty w={w} h={h} lang={lang} />;
  const padL = 46, padR = 34, padT = 16, padB = 18;
  const cw = w - padL - padR, ch = h - padT - padB;
  const maxC = niceMax(Math.max(...data.map((d) => d.cost), 1));
  const maxR = niceMax(Math.max(...data.map((d) => d.roas ?? 0), 1));
  const gap = Math.min(14, cw / (data.length * 4));
  const bw = (cw - gap * (data.length - 1)) / data.length;
  const cx = (i: number) => padL + i * (bw + gap) + bw / 2;
  const ry = (v: number) => padT + ch - (v / maxR) * ch;
  const pts = data.map((d, i) => (d.roas == null ? null : `${cx(i)},${ry(d.roas)}`)).filter(Boolean).join(" ");
  return (
    <Svg width={w} height={h}>
      {[0, 0.5, 1].map((t, i) => (
        <Fragment key={i}>
          <SvgLine x1={padL} y1={padT + ch - t * ch} x2={w - padR} y2={padT + ch - t * ch} stroke={i === 0 ? "#cfd6e2" : "#eef1f6"} strokeWidth={1} />
          <Text x={padL - 5} y={padT + ch - t * ch + 3} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "end" } as never}>{idrShort(maxC * t).replace("Rp ", "").replace("Rp", "")}</Text>
          <Text x={w - padR + 5} y={padT + ch - t * ch + 3} style={{ fontSize: 6.5, fill: GOLD, textAnchor: "start" } as never}>{(maxR * t).toFixed(0)}x</Text>
        </Fragment>
      ))}
      {data.map((d, i) => {
        const bh = Math.max((d.cost / maxC) * ch, 1);
        return (
          <Fragment key={i}>
            <Rect x={padL + i * (bw + gap)} y={padT + ch - bh} width={bw} height={bh} fill={NAVY} rx={2} />
            <Text x={cx(i)} y={padT + ch + 11} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "middle" } as never}>{d.label}</Text>
          </Fragment>
        );
      })}
      {pts.split(" ").length > 1 && <Polyline points={pts} fill="none" stroke={GOLD} strokeWidth={1.6} />}
      {data.map((d, i) => (d.roas == null ? null : <Circle key={i} cx={cx(i)} cy={ry(d.roas)} r={2.4} fill={GOLD} />))}
    </Svg>
  );
}

function FunnelSvg({ rows, w, h, lang }: { rows: { label: string; value: number; note?: string }[]; w: number; h: number; lang: Lang }) {
  if (!rows.length || !rows[0].value) return <Empty w={w} h={h} lang={lang} />;
  const padL = 52, padR = 8;
  const barH = 14, gap = (h - rows.length * barH) / (rows.length + 1);
  const cw = w - padL - padR - 120;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Svg width={w} height={h}>
      {rows.map((r, i) => {
        const y = gap + i * (barH + gap);
        const bw = Math.max((r.value / max) * cw, 2);
        return (
          <Fragment key={i}>
            <Text x={padL - 6} y={y + barH / 2 + 3} style={{ fontSize: 7, fill: MUTED, textAnchor: "end" } as never}>{r.label}</Text>
            <Rect x={padL} y={y} width={bw} height={barH} fill={i === rows.length - 1 ? GOLD : NAVY} rx={2} />
            <Text x={padL + bw + 6} y={y + barH / 2 + 3} style={{ fontSize: 7.5, fill: INK, fontFamily: F_BOLD } as never}>{numFmt(r.value)}</Text>
            {r.note && (
              <Text x={padL + bw + 6 + String(numFmt(r.value)).length * 4.6 + 8} y={y + barH / 2 + 3} style={{ fontSize: 6.5, fill: MUTED } as never}>{r.note}</Text>
            )}
          </Fragment>
        );
      })}
    </Svg>
  );
}

// Donut drawn from two arc paths; a 100%/0% split degenerates as an arc,
// so those render as plain rings instead.
function DonutSvg({ share, label, w, h }: { share: number; label: string; w: number; h: number }) {
  const cxp = w / 2, cyp = h / 2;
  const R = Math.min(w, h) / 2 - 4, r = R * 0.62;
  const frac = Math.max(0, Math.min(1, share));
  const ring = (color: string) => <Circle cx={cxp} cy={cyp} r={(R + r) / 2} fill="none" stroke={color} strokeWidth={R - r} />;
  let body: React.ReactNode;
  if (frac >= 0.999) body = ring(GOLD);
  else if (frac <= 0.001) body = ring("#d7dce6");
  else {
    const a = frac * Math.PI * 2 - Math.PI / 2;
    const st = -Math.PI / 2;
    const p = (rad: number, ang: number) => `${(cxp + rad * Math.cos(ang)).toFixed(2)},${(cyp + rad * Math.sin(ang)).toFixed(2)}`;
    const large = frac > 0.5 ? 1 : 0;
    body = (
      <Fragment>
        <Circle cx={cxp} cy={cyp} r={(R + r) / 2} fill="none" stroke="#d7dce6" strokeWidth={R - r} />
        <Path d={`M ${p(R, st)} A ${R} ${R} 0 ${large} 1 ${p(R, a)} L ${p(r, a)} A ${r} ${r} 0 ${large} 0 ${p(r, st)} Z`} fill={GOLD} />
      </Fragment>
    );
  }
  return (
    <Svg width={w} height={h}>
      {body}
      <Text x={cxp} y={cyp + 2} style={{ fontSize: 17, fill: NAVY, textAnchor: "middle", fontFamily: F_BOLD } as never}>{pctFmt(frac * 100)}</Text>
      <Text x={cxp} y={cyp + 14} style={{ fontSize: 6.5, fill: MUTED, textAnchor: "middle" } as never}>{clip(label, 18)}</Text>
    </Svg>
  );
}

/* ---------------- shared blocks ---------------- */
function Header({ no, title }: { no: string; title: string }) {
  return (
    <View style={{ height: HEADER_H }}>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text style={s.secNo}>{no}</Text>
        <Text style={s.secTitle}>{title}</Text>
      </View>
      <View style={s.rule} />
    </View>
  );
}
function Footer({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footTxt}>{left}</Text>
      <Text style={s.footTxt}>{right}</Text>
    </View>
  );
}
function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 7 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, marginRight: 6 }} />
      <Text style={{ fontSize: 8, color: INK }}>{clip(text, 26)}</Text>
    </View>
  );
}
function KpiCard({ label, value, sub, delta, hero, width, height, lang }: {
  label: string; value: string; sub?: string; delta?: number | null; hero?: boolean;
  width: number; height: number; lang: Lang;
}) {
  const fg = hero ? WHITE : NAVY;
  const dcol = delta == null ? MUTED : delta >= 0 ? (hero ? "#7ee2a8" : GREEN) : (hero ? "#ff9c8f" : RED);
  return (
    <View style={{
      width, height, borderRadius: 7, padding: 12, justifyContent: "flex-start",
      backgroundColor: hero ? NAVY : WHITE, borderWidth: 1, borderColor: hero ? NAVY : BORDER,
    }}>
      <View style={{ width: 42, height: 3.5, backgroundColor: hero ? GOLD_SOFT : GOLD, borderRadius: 2, marginBottom: 9 }} />
      <Text style={[s.label, { color: hero ? GOLD_SOFT : MUTED }]}>{label}</Text>
      <Text style={{ fontFamily: F_BOLD, fontSize: 19, color: fg, marginTop: 5 }}>{value}</Text>
      {!!sub && <Text style={{ fontSize: 7.5, color: hero ? "#c3cee3" : MUTED, marginTop: 4 }}>{clip(sub, 42)}</Text>}
      <View style={{ flexGrow: 1 }} />
      <Text style={{ fontSize: 8, color: dcol, fontFamily: F_BOLD }}>{deltaStr(delta ?? null, lang)}</Text>
    </View>
  );
}
function BigStat({ width, x, title, before, after }: { width: number; x: number | null; title: string; before: string; after: string }) {
  return (
    <View style={[s.card, { width, height: 116, justifyContent: "center" }]}>
      <Text style={{ fontFamily: F_BOLD, fontSize: 27, color: x != null && x >= 1 ? GREEN : NAVY }}>{x != null ? mult(x) : "—"}</Text>
      <Text style={{ fontSize: 9, color: NAVY, fontFamily: F_BOLD, marginTop: 4 }}>{title}</Text>
      <Text style={{ fontSize: 8, color: MUTED, marginTop: 4 }}>{clip(before, 16)}  {"->"}  {clip(after, 16)}</Text>
    </View>
  );
}

/* ---------------- narrative ---------------- */
function narrative(lang: Lang, k: Kpis, period: string, scope: string, atc: number) {
  const conv = k.traffic > 0 ? (k.transactions / k.traffic) * 100 : 0;
  if (lang === "id") {
    return `Pada ${period}, ${scope} membukukan penjualan ${idrFull(k.sales)} dari ${numFmt(k.traffic)} pengunjung produk. `
      + `${numFmt(k.in_cart)} masuk keranjang (rasio ${pctFmt(atc)}) dan ${numFmt(k.transactions)} menjadi order (conversion rate ${pctFmt(conv, 2)}). `
      + `Biaya iklan ${idrFull(k.ad_cost)} dengan ROAS ${roasFmt(k.roas)}.`;
  }
  return `In ${period}, ${scope} recorded ${idrFull(k.sales)} in sales from ${numFmt(k.traffic)} product visitors. `
    + `${numFmt(k.in_cart)} were added to cart (a ${pctFmt(atc)} ratio) and ${numFmt(k.transactions)} became orders (conversion rate ${pctFmt(conv, 2)}). `
    + `Ad spend was ${idrFull(k.ad_cost)} with ROAS at ${roasFmt(k.roas)}.`;
}

/* ==================================================================== */
export function ReportDocument(props: {
  clientName: string;
  ownerName: string;
  storeLabel: string;      // "Store" / "Dealer" — the client's own word
  storeName: string;
  periodLabel: string;
  generatedAt: string;
  current: Summary;
  previous: Summary | null;
  baseline: Summary | null;
  ads: AdsSummary | null;
  trend: { month: string; sales: number }[];
  costRoasTrend: { month: string; cost: number; roas: number | null }[];
  partialWeeks: number | null;
  lang?: Lang;
}) {
  const {
    clientName, ownerName, storeLabel, storeName, periodLabel, generatedAt,
    current, previous, baseline, ads, trend, costRoasTrend, partialWeeks, lang = "id",
  } = props;
  const t = T[lang];
  const k = current.kpis;
  const pk = previous?.kpis ?? null;
  const m = computeMetrics(k);

  const atcRate = k.traffic > 0 ? (k.in_cart / k.traffic) * 100 : 0;
  const scopeName = storeName || ownerName || clientName || t.allStores;

  // Brand share: biggest brand vs everything else in the selection.
  const brands = [...(current.brand_share || [])].sort((a, b) => b.sales - a.sales);
  const topBrand = brands[0];
  const topSales = topBrand?.sales ?? 0;
  const otherSales = brands.slice(1).reduce((a, b) => a + b.sales, 0);
  const shareFrac = topSales + otherSales > 0 ? topSales / (topSales + otherSales) : 0;

  const dealers = [...(current.dealers || [])].filter((d) => d.sales > 0).sort((a, b) => b.sales - a.sales);
  const products = (current.top_products || []).slice(0, 10);
  const prodTotal = products.reduce((a, p) => a + p.sales, 0) || 1;

  const insights = buildInsights({ cur: current, prev: previous, baseline, ads, lang, prevLabel: null });
  const toneLabel = { good: t.good, warn: t.warn, bad: t.bad } as const;
  const toneColor = { good: GREEN, warn: GOLD, bad: RED } as const;

  const footL = `${BRAND} — ${clientName || ""}`.trim().replace(/—\s*$/, "").trim();
  const footR = lang === "id"
    ? "Sumber: dashboard Prof Toko Online (Shopee) · ROAS = Penjualan / Biaya Iklan"
    : "Source: Prof Toko Online dashboard (Shopee) · ROAS = Sales / Ad Spend";

  return (
    <Document title={`${BRAND} — ${clientName} — ${periodLabel}`}>
      {/* ============ COVER ============ */}
      <Page size={PAGE_SIZE} style={{ width: PAGE_W, height: PAGE_H, fontFamily: F_REG, backgroundColor: NAVY }}>
        <View style={{ position: "absolute", top: 0, right: 0, width: 190, height: PAGE_H, backgroundColor: NAVY_DEEP }} />
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 10, backgroundColor: GOLD }} />

        <View style={{ paddingHorizontal: 64, paddingTop: 54 }}>
          <Text style={{ fontFamily: F_BOLD, fontSize: 22, color: WHITE }}>{BRAND}</Text>
          <Text style={{ fontSize: 7.5, color: GOLD_SOFT, letterSpacing: 2.2, marginTop: 3, fontFamily: F_BOLD }}>{TAGLINE}</Text>
        </View>

        <View style={{ paddingHorizontal: 64, marginTop: 100 }}>
          <Text style={{ fontSize: 10, color: GOLD, letterSpacing: 1.5, fontFamily: F_BOLD }}>{t.reportLine}</Text>
          <Text style={{ fontFamily: F_BOLD, fontSize: 38, color: WHITE, marginTop: 14 }}>
            {clip(clientName || scopeName, 34)}
          </Text>
          <Text style={{ fontSize: 13, color: "#c3cee3", marginTop: 12 }}>{periodLabel}</Text>
        </View>

        <View style={{ position: "absolute", left: 64, bottom: 58 }}>
          <View style={{ width: 420, height: 1, backgroundColor: GOLD, opacity: 0.65, marginBottom: 13 }} />
          <Text style={{ fontSize: 8, color: GOLD_SOFT, letterSpacing: 1.4, fontFamily: F_BOLD }}>{t.preparedFor.toUpperCase()}</Text>
          <Text style={{ fontFamily: F_BOLD, fontSize: 13, color: WHITE, marginTop: 6 }}>{clip(ownerName || "—", 40)}</Text>
          <Text style={{ fontSize: 9.5, color: "#c3cee3", marginTop: 5 }}>
            {t[storeLabel === "Dealer" ? "store" : "store"]}: {clip(storeName || t.allStores, 46)}
          </Text>
          <Text style={{ fontSize: 8, color: MUTED, marginTop: 9 }}>{t.generated} {generatedAt}</Text>
        </View>
      </Page>

      {/* ============ 01 EXECUTIVE SUMMARY ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="01" title={t.sec1} />
        <View style={{ height: 82, backgroundColor: NAVY, borderRadius: 8, padding: 13, marginBottom: 13 }}>
          <Text style={{ fontSize: 7.5, color: GOLD_SOFT, fontFamily: F_BOLD, letterSpacing: 1 }}>{t.summary}</Text>
          <Text style={{ fontSize: 9, color: "#e6ebf5", marginTop: 6, lineHeight: 1.5 }}>
            {clip(narrative(lang, k, periodLabel, scopeName, atcRate), 460)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 14, marginBottom: 12 }}>
          <KpiCard lang={lang} width={COL3} height={132} hero label={t.kSales} value={idrFull(k.sales)} sub={t.kSalesSub} delta={pk ? pctDelta(k.sales, pk.sales) : null} />
          <KpiCard lang={lang} width={COL3} height={132} label={t.kTraffic} value={numFmt(k.traffic)} sub={t.kTrafficSub} delta={pk ? pctDelta(k.traffic, pk.traffic) : null} />
          <KpiCard lang={lang} width={COL3} height={132} label={t.kCart} value={numFmt(k.in_cart)} sub={tf(t.kCartSub, { pct: pctFmt(atcRate) })} delta={pk ? pctDelta(k.in_cart, pk.in_cart) : null} />
        </View>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <KpiCard lang={lang} width={COL3} height={132} label={t.kAds} value={idrFull(k.ad_cost)} sub={t.kAdsSub} delta={pk ? pctDelta(k.ad_cost, pk.ad_cost) : null} />
          <KpiCard lang={lang} width={COL3} height={132} hero label={t.kRoas} value={roasFmt(k.roas)} sub={tf(t.kRoasSub, { rp: idrShort(k.ad_cost) })} delta={pk?.roas ? pctDelta(k.roas ?? 0, pk.roas) : null} />
          <KpiCard lang={lang} width={COL3} height={132} label={t.kConv} value={pctFmt(m.convRate, 2)} sub={t.kConvSub} delta={null} />
        </View>
        {partialWeeks != null && partialWeeks < 4 && (
          <Text style={{ position: "absolute", left: PAD, right: PAD, bottom: 30, fontSize: 7, color: RED }}>
            {tf(t.partial, { n: partialWeeks })}
          </Text>
        )}
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 02 BASELINE VS NOW ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="02" title={t.sec2} />
        <BaselineBody baseline={baseline} k={k} lang={lang} />
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 03 TRENDS & COMPOSITION ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="03" title={t.sec3} />
        <View style={{ flexDirection: "row", gap: 14, marginBottom: 12 }}>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>{t.salesTitle}</Text>
            <Text style={s.cardSub}>{tf(t.salesSub, { n: trend.length })}</Text>
            <View style={{ marginTop: 6 }}>
              <BarsSvg lang={lang} w={COL2 - 24} h={132} data={trend.map((x) => ({ label: MONTH_SHORT[x.month] || clip(x.month, 3), value: x.sales }))} />
            </View>
          </View>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>{t.costRoasTitle}</Text>
            <Text style={s.cardSub}>{tf(t.costRoasSub, { n: costRoasTrend.length })}</Text>
            <View style={{ marginTop: 6 }}>
              <CostRoasSvg lang={lang} w={COL2 - 24} h={132} data={costRoasTrend.map((c) => ({ label: MONTH_SHORT[c.month] || clip(c.month, 3), cost: c.cost, roas: c.roas }))} />
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>{t.funnelTitle}</Text>
            <Text style={s.cardSub}>{tf(t.funnelSub, { period: periodLabel })}</Text>
            <View style={{ marginTop: 6 }}>
              <FunnelSvg lang={lang} w={COL2 - 24} h={132} rows={[
                { label: t.fTraffic, value: k.traffic },
                { label: t.fViews, value: k.product_views },
                { label: t.fCart, value: k.in_cart, note: tf(t.cartNote, { pct: pctFmt(atcRate) }) },
                { label: t.fOrders, value: k.transactions },
              ]} />
            </View>
          </View>
          <View style={[s.card, { width: COL2, height: 185 }]}>
            <Text style={s.cardTitle}>{t.shareTitle}</Text>
            <Text style={s.cardSub}>{t.shareSub}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <DonutSvg share={shareFrac} label={topBrand?.brand || "—"} w={COL2 - 170} h={128} />
              <View style={{ marginLeft: 10 }}>
                <Legend color={GOLD} text={`${clip(topBrand?.brand || "—", 12)} — ${idrShort(topSales)}`} />
                <Legend color="#d7dce6" text={tf(t.legendOther, { v: idrShort(otherSales) })} />
              </View>
            </View>
          </View>
        </View>
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 04 ADVERTISING EFFICIENCY ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="04" title={t.sec4} />
        {ads?.totals ? (
          <>
            <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: NAVY }}>
              <Text style={[s.th, { flex: 2.4 }]}>{t.adType}</Text>
              <Text style={[s.th, { flex: 1.6, textAlign: "right" }]}>{t.adCost}</Text>
              <Text style={[s.th, { flex: 1.6, textAlign: "right" }]}>{t.adSales}</Text>
              <Text style={[s.th, { flex: 1, textAlign: "right" }]}>{t.adRoas}</Text>
              <Text style={[s.th, { flex: 1, textAlign: "right" }]}>{t.adOrders}</Text>
              <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>{t.adShare}</Text>
            </View>
            {([[t.gmvMax, ads.totals.gmv_max], [t.groupAds, ads.totals.group_ads], [t.indepAds, ads.totals.independent]] as const).map(([label, v], i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", height: 30, backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
                <Text style={[s.td, { flex: 2.4 }]}>{label}</Text>
                <Text style={[s.td, { flex: 1.6, textAlign: "right", color: MUTED }]}>{idrFull(v?.ads_cost || 0)}</Text>
                <Text style={[s.td, { flex: 1.6, textAlign: "right", fontFamily: F_BOLD, color: NAVY }]}>{idrFull(v?.sales || 0)}</Text>
                <Text style={[s.td, { flex: 1, textAlign: "right", fontFamily: F_BOLD, color: (v?.roas ?? 0) >= 3 ? GREEN : INK }]}>{roasFmt(v?.roas ?? null)}</Text>
                <Text style={[s.td, { flex: 1, textAlign: "right", color: MUTED }]}>{numFmt(v?.orders || 0)}</Text>
                <Text style={[s.td, { flex: 1.2, textAlign: "right", color: MUTED }]}>
                  {ads.totals.total.ads_cost > 0 ? pctFmt(((v?.ads_cost || 0) / ads.totals.total.ads_cost) * 100, 0) : "—"}
                </Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", alignItems: "center", height: 32, borderTopWidth: 1.5, borderTopColor: BORDER, paddingHorizontal: 2 }}>
              <Text style={[s.td, { flex: 2.4, fontFamily: F_BOLD }]}>{t.adTotal}</Text>
              <Text style={[s.td, { flex: 1.6, textAlign: "right", fontFamily: F_BOLD }]}>{idrFull(ads.totals.total.ads_cost)}</Text>
              <Text style={[s.td, { flex: 1.6, textAlign: "right", fontFamily: F_BOLD, color: NAVY }]}>{idrFull(ads.totals.total.sales)}</Text>
              <Text style={[s.td, { flex: 1, textAlign: "right", fontFamily: F_BOLD, color: GOLD }]}>{roasFmt(ads.totals.total.roas)}</Text>
              <Text style={[s.td, { flex: 1, textAlign: "right", fontFamily: F_BOLD }]}>{numFmt(ads.totals.total.orders)}</Text>
              <Text style={[s.td, { flex: 1.2, textAlign: "right", fontFamily: F_BOLD }]}>100%</Text>
            </View>
          </>
        ) : (
          <Text style={{ fontSize: 9, color: MUTED, marginTop: 14 }}>{t.noAds}</Text>
        )}
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 05 STORE PERFORMANCE ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="05" title={`${t.sec5}${dealers.length ? ` — ${dealers.length}` : ""}`} />
        <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: NAVY }}>
          <Text style={[s.th, { width: 26 }]}>{t.no}</Text>
          <Text style={[s.th, { flex: 3 }]}>{t.storeCol}</Text>
          <Text style={[s.th, { flex: 1.7 }]}>{t.city}</Text>
          <Text style={[s.th, { flex: 1.5, textAlign: "right" }]}>{t.sales}</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>{t.traffic}</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>{t.cart}</Text>
          <Text style={[s.th, { flex: 1.3, textAlign: "right" }]}>{t.adCost}</Text>
          <Text style={[s.th, { flex: 0.9, textAlign: "right" }]}>{t.adRoas}</Text>
        </View>
        {dealers.slice(0, 11).map((d, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", height: 27, backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
            <Text style={{ width: 26, fontFamily: F_BOLD, fontSize: 10, color: GOLD }}>{i + 1}</Text>
            <Text style={[s.td, { flex: 3 }]}>{clip(d.store_name, 34)}</Text>
            <Text style={[s.td, { flex: 1.7, color: MUTED }]}>{clip(d.city || "—", 20)}</Text>
            <Text style={[s.td, { flex: 1.5, textAlign: "right", fontFamily: F_BOLD, color: NAVY }]}>{idrFull(d.sales)}</Text>
            <Text style={[s.td, { flex: 1.2, textAlign: "right", color: MUTED }]}>{numFmt(d.traffic)}</Text>
            <Text style={[s.td, { flex: 1.2, textAlign: "right", color: MUTED }]}>{numFmt(d.in_cart)}</Text>
            <Text style={[s.td, { flex: 1.3, textAlign: "right", color: MUTED }]}>{idrFull(d.ad_cost)}</Text>
            <Text style={[s.td, { flex: 0.9, textAlign: "right", fontFamily: F_BOLD, color: d.roas != null && d.roas >= 3 ? GREEN : INK }]}>{roasFmt(d.roas)}</Text>
          </View>
        ))}
        {!dealers.length && <Text style={{ fontSize: 9, color: MUTED, marginTop: 14 }}>{t.noStores}</Text>}
        {dealers.length > 11 && (
          <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 8 }}>
            {tf(t.overflow, { n: dealers.length - 11, v: idrFull(dealers.slice(11).reduce((a, x) => a + x.sales, 0)) })}
          </Text>
        )}
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 06 TOP PRODUCTS ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="06" title={`${t.sec6} — ${periodLabel}`} />
        <View style={{ flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: NAVY }}>
          <Text style={[s.th, { width: 30 }]}>{t.no}</Text>
          <Text style={[s.th, { flex: 6 }]}>{t.product}</Text>
          <Text style={[s.th, { flex: 1.6, textAlign: "right" }]}>{t.sales}</Text>
          <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>{t.pctOfTop}</Text>
        </View>
        {products.map((p, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", height: 29, backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
            <Text style={{ width: 30, fontFamily: F_BOLD, fontSize: 11, color: GOLD }}>{i + 1}</Text>
            <Text style={[s.td, { flex: 6 }]}>{clip(p.name, 78)}</Text>
            <Text style={[s.td, { flex: 1.6, textAlign: "right", fontFamily: F_BOLD, color: NAVY }]}>{idrFull(p.sales)}</Text>
            <Text style={[s.td, { flex: 1.2, textAlign: "right", color: MUTED }]}>{pctFmt((p.sales / prodTotal) * 100)}</Text>
          </View>
        ))}
        {!products.length && <Text style={{ fontSize: 9, color: MUTED, marginTop: 14 }}>{t.noProducts}</Text>}
        <Footer left={footL} right={footR} />
      </Page>

      {/* ============ 07 FINDINGS & NEXT STEPS ============ */}
      <Page size={PAGE_SIZE} style={s.page}>
        <Header no="07" title={t.sec7} />
        {insights.length ? (
          <View>
            <View style={{ flexDirection: "row", gap: 14, marginBottom: 12 }}>
              {insights.slice(0, 2).map((c, i) => (
                <InsightCard key={i} label={toneLabel[c.severity]} color={toneColor[c.severity]} title={c.title} body={c.detail} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 14, marginBottom: 14 }}>
              {insights.slice(2, 4).map((c, i) => (
                <InsightCard key={i} label={toneLabel[c.severity]} color={toneColor[c.severity]} title={c.title} body={c.detail} />
              ))}
            </View>
            <View style={{ backgroundColor: NAVY, borderRadius: 8, padding: 13, height: 112 }}>
              <Text style={{ fontSize: 7.5, color: GOLD_SOFT, fontFamily: F_BOLD, letterSpacing: 1, marginBottom: 7 }}>{t.actions}</Text>
              {insights.filter((x) => x.action).slice(0, 4).map((a, i) => (
                <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
                  <Text style={{ width: 15, fontSize: 8, color: GOLD, fontFamily: F_BOLD }}>{i + 1}.</Text>
                  <Text style={{ flex: 1, fontSize: 8, color: "#e6ebf5", lineHeight: 1.35 }}>{clip(a.action || "", 150)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: 9, color: MUTED, marginTop: 14 }}>{t.noInsights}</Text>
        )}
        <Footer left={footL} right={footR} />
      </Page>
    </Document>
  );
}

function InsightCard({ label, title, body, color }: { label: string; title: string; body: string; color: string }) {
  return (
    <View style={{ width: COL2, height: 104, backgroundColor: WHITE, borderRadius: 7, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 4, borderLeftColor: color, padding: 11 }}>
      <Text style={{ fontSize: 7, color, fontFamily: F_BOLD, letterSpacing: 0.8 }}>{label}</Text>
      <Text style={{ fontFamily: F_BOLD, fontSize: 12.5, color: NAVY, marginTop: 5 }}>{clip(title, 40)}</Text>
      <Text style={{ fontSize: 8, color: MUTED, marginTop: 5, lineHeight: 1.4 }}>{clip(body, 190)}</Text>
    </View>
  );
}

/* ---------------- 02 body ---------------- */
function BaselineBody({ baseline, k, lang }: { baseline: Summary | null; k: Kpis; lang: Lang }) {
  const t = T[lang];
  const b = baseline?.kpis;
  // A Baseline row that exists but is all zeros is the same as none at all.
  if (!b || (!b.sales && !b.traffic && !b.ad_cost)) {
    return (
      <View style={[s.card, { height: 160, justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ fontSize: 11, color: NAVY, fontFamily: F_BOLD }}>{t.baselineNone}</Text>
        <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 6, textAlign: "center", maxWidth: 520 }}>{t.baselineNoneNote}</Text>
      </View>
    );
  }
  const salesX = b.sales > 0 ? k.sales / b.sales : null;
  const trafficX = b.traffic > 0 ? k.traffic / b.traffic : null;
  // Pre-project there was effectively no managed ads programme, so a
  // baseline ROAS computed off a near-zero denominator is an artifact,
  // not a comparable ratio. Say so rather than printing a huge number.
  const adsThin = b.ad_cost < b.sales * 0.001;

  const rows = [
    { metric: t.bSales, before: idrFull(b.sales), after: idrFull(k.sales), change: salesX != null ? mult(salesX) : "—" },
    { metric: t.bTraffic, before: numFmt(b.traffic), after: numFmt(k.traffic), change: trafficX != null ? mult(trafficX) : "—" },
    { metric: t.bAds, before: adsThin ? t.bNoAdsBefore : idrFull(b.ad_cost), after: idrFull(k.ad_cost), change: "—" },
    { metric: t.bRoas, before: adsThin ? "—" : roasFmt(b.roas), after: roasFmt(k.roas), change: "—" },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 14 }}>
        <BigStat width={COL3} x={salesX} title={t.bBigSales} before={idrShort(b.sales)} after={idrShort(k.sales)} />
        <BigStat width={COL3} x={trafficX} title={t.bBigTraffic} before={numFmt(b.traffic)} after={numFmt(k.traffic)} />
        <View style={{ width: COL3, height: 116, backgroundColor: NAVY, borderRadius: 7, padding: 13, justifyContent: "center" }}>
          <Text style={[s.label, { color: GOLD_SOFT }]}>{t.bRoasNow}</Text>
          <Text style={{ fontFamily: F_BOLD, fontSize: 27, color: WHITE, marginTop: 4 }}>{roasFmt(k.roas)}</Text>
          <Text style={{ fontSize: 7.5, color: "#c3cee3", marginTop: 5 }}>
            {adsThin ? t.bNoAdsBefore : tf(t.bRoasBefore, { v: roasFmt(b.roas) })}
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: 7.5, color: MUTED, fontFamily: F_BOLD, letterSpacing: 1, marginBottom: 7 }}>{t.bDetail}</Text>
      <View style={{ flexDirection: "row", paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: NAVY }}>
        <Text style={[s.th, { flex: 3 }]}>{t.bMetric}</Text>
        <Text style={[s.th, { flex: 2, textAlign: "right" }]}>{t.bBefore}</Text>
        <Text style={[s.th, { flex: 2, textAlign: "right" }]}>{t.bAfter}</Text>
        <Text style={[s.th, { flex: 1.2, textAlign: "right" }]}>{t.bChange}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", height: 25, alignItems: "center", backgroundColor: i % 2 ? "#eef1f7" : "transparent", paddingHorizontal: 2 }}>
          <Text style={[s.td, { flex: 3 }]}>{r.metric}</Text>
          <Text style={[s.td, { flex: 2, textAlign: "right", color: MUTED }]}>{r.before}</Text>
          <Text style={[s.td, { flex: 2, textAlign: "right", fontFamily: F_BOLD, color: NAVY }]}>{r.after}</Text>
          <Text style={[s.td, { flex: 1.2, textAlign: "right", fontFamily: F_BOLD, color: GREEN }]}>{r.change}</Text>
        </View>
      ))}
      <Text style={{ fontSize: 7.5, color: MUTED, marginTop: 9, lineHeight: 1.45 }}>{t.bFootnote}</Text>
    </View>
  );
}
