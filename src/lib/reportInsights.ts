// Rule-based insight engine for the client PDF report.
//
// Deliberately NOT an LLM call: these run synchronously at render time, are
// deterministic (the same month always produces the same wording), and are
// auditable — every claim traces to a threshold below. Thresholds are
// exported so they can be tuned per client without touching the rules.
//
// Every insight must answer "so what?": a bare number belongs in the
// scorecard, not here. Each carries a severity, a one-line finding, the
// numbers behind it, and — for anything not already good — a concrete action.

export type Lang = "en" | "id";
export type Severity = "good" | "warn" | "bad";
export type Insight = { severity: Severity; title: string; detail: string; action?: string };

export type Kpis = {
  sales: number; gmv: number; traffic: number; in_cart: number; orders: number;
  transactions: number; orders_created: number; product_views: number;
  visitor_cart_adds: number; ad_cost: number; roas: number | null;
};
export type Dealer = {
  store_name: string; city: string; sales: number; traffic: number;
  in_cart: number; orders: number; ad_cost: number; roas: number | null;
};
export type Summary = {
  kpis: Kpis;
  monthly_sales: { month: string; sales: number }[];
  top_products: { name: string; sales: number }[];
  brand_share: { brand: string; sales: number }[];
  perf_trend: { bucket: string; sales: number; traffic: number; in_cart: number }[];
  traffic_trend: { month: string; traffic: number; in_cart: number; transactions: number; visitor_cart_adds: number }[];
  cost_roas: { month: string; cost: number; roas: number | null }[];
  dealers: Dealer[];
};
export type AdsTotals = {
  ads_cost: number; sales: number; roas: number | null;
  view: number; click: number; orders: number; item_sold: number;
};
export type AdsSummary = {
  totals: { total: AdsTotals; gmv_max: AdsTotals; group_ads: AdsTotals; independent: AdsTotals };
  funnel: { view: number; click: number; add_to_cart: number; orders: number };
  products: { kode_produk: string; nama_produk: string | null; ads_cost: number; sales: number; roas: number | null; orders: number; item_sold: number }[];
};

// ── Benchmarks ───────────────────────────────────────────────────────────
// Starting points for Shopee ID, not universal truths — revisit per category
// once there's enough portfolio history to derive real percentiles.
export const BENCH = {
  roasGood: 5, roasWarn: 3,          // × return on ad spend
  acosGood: 15, acosWarn: 25,        // ad cost as % of sales
  cartRateGood: 8, cartRateWarn: 4,  // visitors who add to cart, %
  convRateGood: 2.5, convRateWarn: 1,// visitors who complete an order, %
  cartToOrderGood: 45, cartToOrderWarn: 30, // cart → completed order, %
  materialShare: 0.2,                // ad type must hold >20% of spend to flag
  moveThreshold: 10,                 // % change worth calling a trend
};

const L = (lang: Lang, en: string, id: string) => (lang === "id" ? id : en);

export const idrFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
export const idrShort = (n: number) =>
  "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
export const numFmt = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n || 0));
export const pctFmt = (n: number | null, dp = 1) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(dp) + "%");
export const roasFmt = (n: number | null) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(2) + "×");

/** Percentage change, or null when there's no meaningful base to compare to. */
export function pctDelta(cur: number, prev: number): number | null {
  if (!prev || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

/** The calendar month before `month`, or null for Januari/Baseline/unknown. */
export function priorMonth(month: string | null): string | null {
  if (!month) return null;
  const i = MONTHS.indexOf(month);
  return i > 0 ? MONTHS[i - 1] : null;
}

export type Metrics = {
  acos: number | null;        // ad spend as % of sales
  cartRate: number | null;    // in_cart / traffic
  convRate: number | null;    // transactions / traffic
  cartToOrder: number | null; // transactions / in_cart
};

export function computeMetrics(k: Kpis | undefined): Metrics {
  if (!k) return { acos: null, cartRate: null, convRate: null, cartToOrder: null };
  return {
    acos:        k.sales   > 0 ? (k.ad_cost / k.sales) * 100      : null,
    cartRate:    k.traffic > 0 ? (k.in_cart / k.traffic) * 100    : null,
    convRate:    k.traffic > 0 ? (k.transactions / k.traffic) * 100 : null,
    cartToOrder: k.in_cart > 0 ? (k.transactions / k.in_cart) * 100 : null,
  };
}

/** Human label for the report's filter scope, e.g. "Yunita · Kidzmom · All Stores". */
export function scopeLabel(
  sel: { owner?: string; brand?: string; store?: string },
  lang: Lang,
  storeLabel = "Stores",
): string {
  const parts = [
    sel.owner || L(lang, "All Owners", "Semua Pemilik"),
    sel.brand || L(lang, "All Brands", "Semua Merek"),
    sel.store || L(lang, `All ${storeLabel}`, `Semua ${storeLabel}`),
  ];
  return parts.join(" · ");
}

export function buildInsights(args: {
  cur: Summary | null;
  prev: Summary | null;
  baseline: Summary | null;
  ads: AdsSummary | null;
  lang: Lang;
  prevLabel?: string | null;
}): Insight[] {
  const { cur, prev, baseline, ads, lang, prevLabel } = args;
  if (!cur?.kpis) return [];
  const k = cur.kpis;
  const m = computeMetrics(k);
  const out: Insight[] = [];

  // ── 1. Sales movement vs the previous month ──────────────────────────
  if (prev?.kpis && prev.kpis.sales > 0) {
    const d = pctDelta(k.sales, prev.kpis.sales);
    if (d != null && Math.abs(d) >= BENCH.moveThreshold) {
      const up = d > 0;
      out.push({
        severity: up ? "good" : "bad",
        title: up
          ? L(lang, `Sales grew ${d.toFixed(1)}%`, `Penjualan naik ${d.toFixed(1)}%`)
          : L(lang, `Sales fell ${Math.abs(d).toFixed(1)}%`, `Penjualan turun ${Math.abs(d).toFixed(1)}%`),
        detail: L(lang,
          `${idrFull(k.sales)} this period vs ${idrFull(prev.kpis.sales)} in ${prevLabel || "the prior month"}.`,
          `${idrFull(k.sales)} periode ini vs ${idrFull(prev.kpis.sales)} di ${prevLabel || "bulan sebelumnya"}.`),
        action: up ? undefined : L(lang,
          "Check the funnel and ads sections below to see whether this is a traffic problem or a conversion problem.",
          "Cek bagian funnel dan iklan di bawah untuk melihat apakah ini masalah trafik atau konversi."),
      });
    }
  }

  // ── 2. Progress since Baseline (the agency's value proof) ────────────
  if (baseline?.kpis && baseline.kpis.sales > 0) {
    const d = pctDelta(k.sales, baseline.kpis.sales);
    const bRoas = baseline.kpis.roas;
    if (d != null) {
      const up = d > 0;
      const roasBit = (bRoas != null && k.roas != null)
        ? L(lang, ` ROAS moved ${roasFmt(bRoas)} → ${roasFmt(k.roas)}.`, ` ROAS bergerak ${roasFmt(bRoas)} → ${roasFmt(k.roas)}.`)
        : "";
      out.push({
        severity: up ? "good" : "warn",
        title: up
          ? L(lang, `${d.toFixed(0)}% above the starting baseline`, `${d.toFixed(0)}% di atas baseline awal`)
          : L(lang, `${Math.abs(d).toFixed(0)}% below the starting baseline`, `${Math.abs(d).toFixed(0)}% di bawah baseline awal`),
        detail: L(lang,
          `Baseline (Month Awal) sales were ${idrFull(baseline.kpis.sales)}; this period is ${idrFull(k.sales)}.${roasBit}`,
          `Penjualan Baseline (Month Awal) ${idrFull(baseline.kpis.sales)}; periode ini ${idrFull(k.sales)}.${roasBit}`),
      });
    }
  }

  // ── 3. ROAS level ────────────────────────────────────────────────────
  if (k.roas != null && k.ad_cost > 0) {
    const sev: Severity = k.roas >= BENCH.roasGood ? "good" : k.roas >= BENCH.roasWarn ? "warn" : "bad";
    if (sev !== "good") {
      out.push({
        severity: sev,
        title: L(lang, `ROAS at ${roasFmt(k.roas)} is below target`, `ROAS ${roasFmt(k.roas)} di bawah target`),
        detail: L(lang,
          `${idrFull(k.ad_cost)} of ad spend returned ${idrFull(k.sales)} in sales. Target is ${BENCH.roasGood}× or better.`,
          `Biaya iklan ${idrFull(k.ad_cost)} menghasilkan penjualan ${idrFull(k.sales)}. Target ${BENCH.roasGood}× atau lebih.`),
        action: L(lang,
          "Pause or reduce the lowest-ROAS campaigns in the ads table and move that budget to the best-performing ad type.",
          "Hentikan atau kurangi kampanye dengan ROAS terendah di tabel iklan, dan pindahkan budget-nya ke tipe iklan terbaik."),
      });
    } else {
      out.push({
        severity: "good",
        title: L(lang, `Healthy ROAS at ${roasFmt(k.roas)}`, `ROAS sehat di ${roasFmt(k.roas)}`),
        detail: L(lang,
          `${idrFull(k.ad_cost)} of ad spend returned ${idrFull(k.sales)} in sales.`,
          `Biaya iklan ${idrFull(k.ad_cost)} menghasilkan penjualan ${idrFull(k.sales)}.`),
      });
    }
  }

  // ── 4. Ad cost as a share of sales (ACOS) ────────────────────────────
  if (m.acos != null && k.ad_cost > 0 && m.acos > BENCH.acosGood) {
    const sev: Severity = m.acos > BENCH.acosWarn ? "bad" : "warn";
    out.push({
      severity: sev,
      title: L(lang, `Ads consume ${pctFmt(m.acos)} of sales`, `Iklan menyerap ${pctFmt(m.acos)} dari penjualan`),
      detail: L(lang,
        `Healthy is under ${BENCH.acosGood}%. Above ${BENCH.acosWarn}% margin is usually too thin to sustain.`,
        `Sehat di bawah ${BENCH.acosGood}%. Di atas ${BENCH.acosWarn}% margin biasanya terlalu tipis untuk bertahan.`),
      action: L(lang,
        "Raise bids only on products that convert; cut spend on products with traffic but few orders.",
        "Naikkan bid hanya pada produk yang convert; potong belanja pada produk yang ramai dilihat tapi sedikit pesanan."),
    });
  }

  // ── 5. Weakest funnel step ───────────────────────────────────────────
  // Diagnose in order: do they arrive? do they add to cart? do they buy?
  if (m.cartRate != null && m.cartRate < BENCH.cartRateWarn) {
    out.push({
      severity: "bad",
      title: L(lang, `Only ${pctFmt(m.cartRate)} of visitors add to cart`, `Hanya ${pctFmt(m.cartRate)} pengunjung masuk keranjang`),
      detail: L(lang,
        `${numFmt(k.traffic)} visitors produced ${numFmt(k.in_cart)} cart adds. Traffic is arriving but the product page is not persuading.`,
        `${numFmt(k.traffic)} pengunjung menghasilkan ${numFmt(k.in_cart)} masuk keranjang. Trafik datang tapi halaman produk belum meyakinkan.`),
      action: L(lang,
        "Review main image, title, price vs competitors, and review count on the top-traffic products.",
        "Tinjau gambar utama, judul, harga vs kompetitor, dan jumlah ulasan pada produk dengan trafik tertinggi."),
    });
  } else if (m.cartToOrder != null && m.cartToOrder < BENCH.cartToOrderWarn) {
    out.push({
      severity: "warn",
      title: L(lang, `${pctFmt(100 - m.cartToOrder)} of carts never become orders`, `${pctFmt(100 - m.cartToOrder)} keranjang tidak jadi pesanan`),
      detail: L(lang,
        `${numFmt(k.in_cart)} cart adds produced ${numFmt(k.transactions)} completed orders.`,
        `${numFmt(k.in_cart)} masuk keranjang menghasilkan ${numFmt(k.transactions)} pesanan selesai.`),
      action: L(lang,
        "Cart abandonment is usually shipping cost or stock. Check free-shipping thresholds and vouchers.",
        "Keranjang ditinggalkan biasanya karena ongkir atau stok. Cek batas gratis ongkir dan voucher."),
    });
  } else if (m.convRate != null && m.convRate >= BENCH.convRateGood) {
    out.push({
      severity: "good",
      title: L(lang, `Strong conversion at ${pctFmt(m.convRate)}`, `Konversi kuat di ${pctFmt(m.convRate)}`),
      detail: L(lang,
        `${numFmt(k.traffic)} visitors produced ${numFmt(k.transactions)} completed orders.`,
        `${numFmt(k.traffic)} pengunjung menghasilkan ${numFmt(k.transactions)} pesanan selesai.`),
    });
  }

  // ── 6. Ad budget allocation across ad types ──────────────────────────
  if (ads?.totals) {
    const t = ads.totals;
    const totalSpend = t.total.ads_cost || 0;
    const types: { key: string; label: string; v: AdsTotals }[] = [
      { key: "gmv_max",     label: "GMV Max Auto",                                          v: t.gmv_max },
      { key: "group_ads",   label: L(lang, "Group Ads", "Iklan Grup"),                      v: t.group_ads },
      { key: "independent", label: L(lang, "Independent Ads", "Iklan Mandiri"),             v: t.independent },
    ].filter((x) => x.v && x.v.ads_cost > 0);

    if (totalSpend > 0 && types.length >= 2) {
      const ranked = [...types].sort((a, b) => (a.v.roas ?? 0) - (b.v.roas ?? 0));
      const worst = ranked[0];
      const best = ranked[ranked.length - 1];
      const worstShare = worst.v.ads_cost / totalSpend;
      // Only worth acting on when the weak type holds a material slice of
      // budget AND the gap to the best type is real.
      if (worstShare >= BENCH.materialShare && (best.v.roas ?? 0) > (worst.v.roas ?? 0) * 1.5) {
        out.push({
          severity: "warn",
          title: L(lang,
            `${worst.label} is your least efficient spend`,
            `${worst.label} adalah belanja paling tidak efisien`),
          detail: L(lang,
            `${worst.label} took ${pctFmt(worstShare * 100, 0)} of ad budget at ${roasFmt(worst.v.roas)}, while ${best.label} returned ${roasFmt(best.v.roas)}.`,
            `${worst.label} mengambil ${pctFmt(worstShare * 100, 0)} budget iklan di ${roasFmt(worst.v.roas)}, sedangkan ${best.label} menghasilkan ${roasFmt(best.v.roas)}.`),
          action: L(lang,
            `Shift part of the ${worst.label} budget to ${best.label} and re-measure next week.`,
            `Pindahkan sebagian budget ${worst.label} ke ${best.label} lalu ukur ulang minggu depan.`),
        });
      }
    }
  }

  // ── 7. Spread between stores ─────────────────────────────────────────
  const withSales = (cur.dealers || []).filter((x) => x.sales > 0);
  if (withSales.length > 1) {
    const sorted = [...withSales].sort((a, b) => b.sales - a.sales);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const share = best.sales / withSales.reduce((s, x) => s + x.sales, 0);
    if (share > 0.6) {
      out.push({
        severity: "warn",
        title: L(lang,
          `${pctFmt(share * 100, 0)} of sales come from one store`,
          `${pctFmt(share * 100, 0)} penjualan datang dari satu toko`),
        detail: L(lang,
          `${best.store_name} contributed ${idrFull(best.sales)}, while ${worst.store_name} contributed ${idrFull(worst.sales)}.`,
          `${best.store_name} menyumbang ${idrFull(best.sales)}, sedangkan ${worst.store_name} menyumbang ${idrFull(worst.sales)}.`),
        action: L(lang,
          "Concentration is a risk. Apply what works at the top store to the weakest one.",
          "Konsentrasi ini berisiko. Terapkan strategi toko terbaik ke toko terlemah."),
      });
    }
  }

  // Worst news first — a client should see problems before praise.
  const rank: Record<Severity, number> = { bad: 0, warn: 1, good: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
}
