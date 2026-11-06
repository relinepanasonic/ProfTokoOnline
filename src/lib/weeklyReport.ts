// Builds the weekly WhatsApp report text from erp_performance() rows (one row per store per week).

export type PerfRow = {
  store: string; periodStart: string; periodEnd: string;
  sales: number; gmv: number; traffic: number; orders: number; itemsSold: number;
  ads: { total: { cost: number; sales: number } };
};

export type Totals = { sales: number; orders: number; itemsSold: number; traffic: number; adsCost: number; adsSales: number };

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// "Today" in Asia/Jakarta as YYYY-MM-DD.
export function jakartaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

// The last COMPLETED Monday..Sunday week before `today` (YYYY-MM-DD), plus the week before it.
export function lastWeekRange(today: string): { start: string; end: string; prevStart: string } {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = t - dow * DAY;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(thisMonday - 7 * DAY), end: iso(thisMonday - DAY), prevStart: iso(thisMonday - 14 * DAY) };
}

export function sumRows(rows: PerfRow[]): Totals {
  const t: Totals = { sales: 0, orders: 0, itemsSold: 0, traffic: 0, adsCost: 0, adsSales: 0 };
  for (const r of rows) {
    t.sales += r.sales; t.orders += r.orders; t.itemsSold += r.itemsSold; t.traffic += r.traffic;
    t.adsCost += r.ads?.total?.cost || 0; t.adsSales += r.ads?.total?.sales || 0;
  }
  return t;
}

export function rupiah(n: number): string {
  const v = Math.round(n);
  if (v >= 1_000_000_000) return `Rp ${(v / 1_000_000_000).toFixed(2).replace(".", ",")} M`;
  if (v >= 1_000_000) return `Rp ${(v / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  return `Rp ${v.toLocaleString("id-ID")}`;
}

export function num(n: number): string {
  return Math.round(n).toLocaleString("id-ID");
}

export function dayLabel(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${String(dd).padStart(2, "0")} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

// ▲ 12,3% / ▼ 4,0% / "baru" (no previous value) / "–" (both zero)
export function change(cur: number, prev: number): string {
  if (!prev) return cur ? "baru" : "–";
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.05) return "▬ 0%";
  return `${p > 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1).replace(".", ",")}%`;
}

export function roas(sales: number, cost: number): string {
  return cost > 0 ? (sales / cost).toFixed(2).replace(".", ",") : "–";
}

export type OwnerReport = {
  owner: string; start: string; end: string; hasData: boolean; message: string; totals: Totals;
  stores: { store: string; sales: number; orders: number; adsCost: number }[];
};

export function buildOwnerReport(
  owner: string, start: string, end: string, stores: string[], last: PerfRow[], prev: PerfRow[],
): OwnerReport {
  const mine = new Set(stores);
  const cur = last.filter((r) => mine.has(r.store));
  const old = prev.filter((r) => mine.has(r.store));
  const t = sumRows(cur), p = sumRows(old);
  const header = `*Laporan Mingguan ${owner}*\n${dayLabel(start)} – ${dayLabel(end)}`;

  const perStore = new Map<string, { sales: number; orders: number; adsCost: number }>();
  for (const r of cur) {
    const s = perStore.get(r.store) || { sales: 0, orders: 0, adsCost: 0 };
    s.sales += r.sales; s.orders += r.orders; s.adsCost += r.ads?.total?.cost || 0;
    perStore.set(r.store, s);
  }
  const storeList = [...perStore.entries()].map(([store, v]) => ({ store, ...v })).sort((a, b) => b.sales - a.sales);

  const hasData = cur.length > 0 && (t.sales > 0 || t.orders > 0 || t.adsCost > 0);
  if (!hasData) {
    return {
      owner, start, end, hasData: false, totals: t, stores: storeList,
      message: `${header}\n\nData minggu ini belum tersedia. Laporan akan dikirim setelah data diunggah.`,
    };
  }

  const lines = [
    header, "",
    `💰 Penjualan: *${rupiah(t.sales)}* (${change(t.sales, p.sales)})`,
    `🧾 Pesanan: *${num(t.orders)}* (${change(t.orders, p.orders)})`,
    `📦 Produk terjual: *${num(t.itemsSold)}* (${change(t.itemsSold, p.itemsSold)})`,
    `👀 Pengunjung: *${num(t.traffic)}* (${change(t.traffic, p.traffic)})`,
    `📣 Biaya iklan: *${rupiah(t.adsCost)}* (${change(t.adsCost, p.adsCost)})`,
    `🎯 ROAS iklan: *${roas(t.adsSales, t.adsCost)}* (minggu lalu ${roas(p.adsSales, p.adsCost)})`,
  ];
  if (storeList.length > 1) {
    lines.push("", "*Per toko*");
    for (const s of storeList) lines.push(`• ${s.store}: ${rupiah(s.sales)} · ${num(s.orders)} pesanan`);
  }
  lines.push("", "_Perubahan dibanding minggu sebelumnya._");
  return { owner, start, end, hasData: true, message: lines.join("\n"), totals: t, stores: storeList };
}
