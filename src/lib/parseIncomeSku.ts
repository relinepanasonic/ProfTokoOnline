// Parser for Shopee's NEWER "Laporan Penghasilan" export (sheet "Penghasilan").
//
// Unlike the older one-row-per-order "Income" sheet (see parseFinance.ts),
// this layout has, for every order:
//   - an "Order" row  (column "Lihat berdasarkan" = "Order") with the order's totals, and
//   - one "Sku" row per product on that order, carrying the product's own
//     ID/name and Shopee's own per-product split of every fee.
// The Sku rows of an order add up exactly to its Order row, so per-product
// costs are REAL numbers (no spreading store totals by sales share).
//
// Layout (verified against a real export):
//   row 0: top groups   ("Informasi Pesanan", "Rincian Jumlah Pelepasan Dana", "Buyer Info", ...)
//   row 1: sub groups   ("Total Penghasilan", "Subtotal Pesanan", "Subtotal Ongkos Kirim",
//                        "Voucher dan Potongan Harga", "Biaya Platform", "Biaya Gratis Ongkir XTRA",
//                        "Biaya Layanan", "Biaya Promosi", "Biaya Lainnya", "Pajak", ...)
//   row 2: real column headers
//   row 3+: data
// Fee columns are classified by their GROUP (row 1), not by exact header name,
// because Shopee adds/removes fee columns (e.g. "Biaya Gratis Ongkir XTRA -
// Ukuran Biasa (Kategori D/F/G)") from one export to the next.
//
// Some months Shopee fills a fee (e.g. "Biaya Layanan Promo XTRA") ONLY on the Order
// row and leaves it 0 on the Sku rows — yet each Sku row's own Total Penghasilan
// already includes its share. So for every Sku row, (its Total Penghasilan minus the
// parts we can see) IS that unsplit fee, exactly as Shopee charged it; it is booked to
// the bucket(s) the Order row says were left unsplit. No estimation, purely finance data.
//
// Buckets match the older parser so finance_summary keeps reconciling:
//   net_income == sales + refund + promotion + delivery + affiliate + marketplace_fee + misc
// where marketplace_fee INCLUDES pajak (as the old "Bea Masuk, PPN & PPh" did);
// pajak is also reported on its own.
import { toNum } from "./parse";
import type { FinanceRow } from "./parseFinance";

export interface SkuRow {
  order_no: string;
  kode_produk: string;
  nama_produk: string | null;
  order_date: string | null;
  release_date: string | null;
  sales: number;
  refund: number;
  promotion_cost: number;
  delivery_cost: number;
  affiliate_cost: number;
  marketplace_fee: number; // EXCLUDES pajak (reported separately)
  misc: number;
  pajak: number;
  net_income: number;
}

export interface IncomeSkuParsed {
  username: string | null;
  periodeStart: string | null;
  periodeEnd: string | null;
  rows: FinanceRow[];      // one per order  -> finance_rows
  skuRows: SkuRow[];       // one per product line -> finance_sku_rows
  unreconciled: number;    // orders whose parts don't add up to Total Penghasilan (±1)
}

type Bucket = "sales" | "refund" | "promotion" | "delivery" | "affiliate" | "marketplace" | "misc" | "pajak";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  return toNum(v) ?? 0;
}

function asISODate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** True when a sheet matrix is the newer Penghasilan layout (has the Order/Sku switch column). */
export function isIncomeSkuMatrix(matrix: unknown[][]): boolean {
  for (let i = 0; i < Math.min(matrix.length, 8); i++) {
    const cells = (matrix[i] || []).map(norm);
    if (cells.includes("lihat berdasarkan") && cells.includes("no. pesanan")) return true;
  }
  return false;
}

/** Username + period from the workbook's "Summary" sheet (rows like ["Username (Penjual)", "x"]). */
export function parseIncomeSummary(summary: unknown[][] | undefined): { username: string | null; periodeStart: string | null; periodeEnd: string | null } {
  let username: string | null = null, periodeStart: string | null = null, periodeEnd: string | null = null;
  for (const r of summary || []) {
    const label = norm(r?.[0]);
    if (label === "username (penjual)") username = String(r[1] ?? "").trim() || null;
    else if (label === "dari") periodeStart = asISODate(r[1]);
    else if (label === "ke") periodeEnd = asISODate(r[1]);
  }
  return { username, periodeStart, periodeEnd };
}

function bucketForGroup(group: string, header: string): Bucket {
  const g = norm(group), h = norm(header);
  if (g === "subtotal ongkos kirim") return "delivery";
  if (g === "voucher dan potongan harga") return "promotion";
  if (g === "pajak") return "pajak";
  if (g === "biaya promosi") {
    if (h.includes("ams")) return "affiliate";
    if (h.includes("isi saldo")) return "misc";
    return "marketplace"; // Biaya Kampanye etc.
  }
  // Biaya Platform / Gratis Ongkir XTRA / Biaya Layanan / Biaya Lainnya and
  // any fee group Shopee adds later: a cost, so it belongs with marketplace fees.
  return "marketplace";
}

export function parseIncomeSkuMatrix(
  matrix: unknown[][],
  summary?: unknown[][],
): IncomeSkuParsed {
  const headerIdx = matrix.findIndex((r, i) => i < 8 && (r || []).map(norm).includes("lihat berdasarkan"));
  if (headerIdx < 0) return { username: null, periodeStart: null, periodeEnd: null, rows: [], skuRows: [], unreconciled: 0 };

  const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const groups = (matrix[headerIdx - 1] || []).map((h) => String(h ?? "").trim());
  const col = (name: string) => headers.findIndex((h) => norm(h) === norm(name));

  const cView = col("Lihat berdasarkan");
  const cOrderNo = col("No. Pesanan");
  const cProductId = col("ID Produk");
  const cProductName = col("Nama Produk");
  const cOrderDate = col("Waktu Pesanan Dibuat");
  const cRelease = col("Tanggal Dana Dilepaskan");
  const cNet = col("Total Penghasilan");
  const cSales = col("Harga Produk");
  const cRefund = col("Jumlah Pengembalian Dana ke Pembeli");
  const cBuyer = col("Username (Pembeli)");
  const cPayment = col("Metode pembayaran pembeli");
  const cJasaKirim = col("Jasa Kirim");
  const cKurir = col("Nama Kurir");

  // The money block runs from "Total Penghasilan" up to the buyer columns; the
  // columns after it (incl. a second "Pajak" group = tax BASE, not a cost) are ignored.
  const end = cBuyer > cNet ? cBuyer : headers.length;

  // Classify every money column once (carry the group label forward until the next one).
  const bucketOf: (Bucket | null)[] = headers.map(() => null);
  let group = "";
  for (let c = cNet + 1; c < end; c++) {
    if (groups[c]) group = groups[c];
    if (c === cSales) { bucketOf[c] = "sales"; continue; }
    if (c === cRefund) { bucketOf[c] = "refund"; continue; }
    if (norm(group) === "subtotal pesanan") continue; // nothing else costs money in this group
    bucketOf[c] = bucketForGroup(group, headers[c]);
  }

  const split = (r: unknown[]) => {
    const t: Record<Bucket, number> = { sales: 0, refund: 0, promotion: 0, delivery: 0, affiliate: 0, marketplace: 0, misc: 0, pajak: 0 };
    for (let c = cNet + 1; c < end; c++) {
      const b = bucketOf[c];
      if (b) t[b] += num(r[c]);
    }
    return t;
  };

  const rows: FinanceRow[] = [];
  const skuRows: SkuRow[] = [];
  const orderTotals = new Map<string, Record<Bucket, number>>();
  let unreconciled = 0;

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    const orderNo = String(r[cOrderNo] ?? "").trim();
    if (!orderNo) continue;
    const view = norm(r[cView]);
    const t = split(r);
    const net = num(r[cNet]);
    const sum = t.sales + t.refund + t.promotion + t.delivery + t.affiliate + t.marketplace + t.misc + t.pajak;

    if (view === "order") {
      orderTotals.set(orderNo, t);
      if (Math.abs(sum - net) > 1) unreconciled++;
      const raw: Record<string, unknown> = {};
      headers.forEach((h, hi) => { if (h && hi < end) raw[h] = r[hi] ?? null; });
      rows.push({
        order_no: orderNo,
        buyer_username: cBuyer >= 0 ? String(r[cBuyer] ?? "").trim() || null : null,
        payment_method: cPayment >= 0 ? String(r[cPayment] ?? "").trim() || null : null,
        order_date: asISODate(r[cOrderDate]),
        release_date: asISODate(r[cRelease]),
        sales: t.sales,
        promotion_cost: t.promotion,
        refund: t.refund,
        delivery_cost: t.delivery,
        affiliate_cost: t.affiliate,
        marketplace_fee: t.marketplace + t.pajak, // keeps finance_summary's identity, see header
        misc: t.misc,
        net_income: net,
        jasa_kirim: cJasaKirim >= 0 ? String(r[cJasaKirim] ?? "").trim() || null : null,
        nama_kurir: cKurir >= 0 ? String(r[cKurir] ?? "").trim() || null : null,
        pajak: t.pajak,
        raw,
      });
    } else if (view === "sku") {
      const kode = String(r[cProductId] ?? "").trim();
      if (!kode || kode === "-") continue;
      skuRows.push({
        order_no: orderNo,
        kode_produk: kode,
        nama_produk: cProductName >= 0 ? String(r[cProductName] ?? "").trim() || null : null,
        order_date: asISODate(r[cOrderDate]),
        release_date: asISODate(r[cRelease]),
        sales: t.sales,
        refund: t.refund,
        promotion_cost: t.promotion,
        delivery_cost: t.delivery,
        affiliate_cost: t.affiliate,
        marketplace_fee: t.marketplace,
        misc: t.misc,
        pajak: t.pajak,
        net_income: net,
      });
    }
  }

  allocateOrderRemainders(skuRows, orderTotals);

  return { ...parseIncomeSummary(summary), rows, skuRows, unreconciled };
}

// which SkuRow field each bucket lands in (sales is never reallocated; it is always on the Sku rows)
const SKU_FIELD = {
  refund: "refund", promotion: "promotion_cost", delivery: "delivery_cost", affiliate: "affiliate_cost",
  misc: "misc", marketplace: "marketplace_fee", pajak: "pajak",
} as const;

/**
 * Make every order's Sku lines add up to its Order row, bucket by bucket. A line's own
 * Total Penghasilan minus its visible parts is the fee Shopee charged it but did not
 * itemise; it goes to the bucket(s) the Order row shows as left unsplit.
 */
function allocateOrderRemainders(skuRows: SkuRow[], orderTotals: Map<string, Record<Bucket, number>>): void {
  const byOrder = new Map<string, SkuRow[]>();
  for (const s of skuRows) (byOrder.get(s.order_no) ?? byOrder.set(s.order_no, []).get(s.order_no)!).push(s);

  const buckets = Object.keys(SKU_FIELD) as (keyof typeof SKU_FIELD)[];
  for (const [orderNo, lines] of byOrder) {
    const t = orderTotals.get(orderNo);
    if (!t) continue;

    // what the Order row has in each bucket that its Sku lines do not show
    const remainder = {} as Record<keyof typeof SKU_FIELD, number>;
    let remainderTotal = 0;
    for (const b of buckets) {
      remainder[b] = t[b] - lines.reduce((a, l) => a + l[SKU_FIELD[b]], 0);
      if (Math.abs(remainder[b]) < 0.5) remainder[b] = 0;
      remainderTotal += remainder[b];
    }
    if (remainderTotal === 0) continue;
    const open = buckets.filter((b) => remainder[b] !== 0);

    for (const l of lines) {
      const visible = l.sales + l.refund + l.promotion_cost + l.delivery_cost + l.affiliate_cost + l.marketplace_fee + l.misc + l.pajak;
      const unsplit = l.net_income - visible; // this line's own share of the unitemised fee(s)
      if (Math.abs(unsplit) < 0.5) continue;
      let given = 0;
      open.forEach((b, i) => {
        const part = i === open.length - 1 ? unsplit - given : Math.round(unsplit * (remainder[b] / remainderTotal));
        l[SKU_FIELD[b]] += part;
        given += part;
      });
    }
  }
}
