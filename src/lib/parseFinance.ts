// Parser for the Shopee "Laporan Penghasilan" (Income) export.
// Workbook has 3 sheets: Summary, Income, Seller Fee — we read "Income".
//
// Income sheet layout:
//   row 0: header ["Username (Penjual)","Dari","ke"]
//   row 1: ["japarutomo","2026-06-29","2026-07-04"]
//   row 2-3: blank
//   row 4: ["total(Rp)"]  (small label, ignored)
//   row 5: the real per-order header row
//   row 6+: one row per order
import { toNum } from "./parse";

// Column-letter mapping to Shopee's Income sheet (verified against the real
// export, 0 mismatches across 248 rows): sales(H) + promotion_cost(I,K,L,M,N,O)
// + refund(J) + delivery_cost(P-V) + affiliate_cost(W) + marketplace_fee(X-AE)
// + misc(AF) == net_income(AG) EXACTLY, using each column's own raw signed
// value (costs are already negative in the source file). Do not take abs()
// here — the identity only holds with signed values; abs() is a display
// concern for the frontend, not a storage concern.
export interface FinanceRow {
  order_no: string | null;
  buyer_username: string | null;
  payment_method: string | null;
  order_date: string | null;   // ISO yyyy-mm-dd
  release_date: string | null; // ISO yyyy-mm-dd
  sales: number | null;             // H
  promotion_cost: number | null;    // I + K + L + M + N + O
  refund: number | null;            // J
  delivery_cost: number | null;     // P + Q + R + S + T + U + V
  affiliate_cost: number | null;    // W
  marketplace_fee: number | null;   // X + Y + Z + AA + AB + AC + AD + AE
  misc: number | null;              // AF
  net_income: number | null;        // AG
  jasa_kirim: string | null;
  nama_kurir: string | null;
  raw: Record<string, unknown>;
}

export interface FinanceParsed {
  username: string | null;
  periodeStart: string | null;
  periodeEnd: string | null;
  rows: FinanceRow[];
}

function cell(row: unknown[], i: number): string {
  return String(row?.[i] ?? "").trim();
}

// Excel already gives plain "yyyy-mm-dd" strings for this report (verified
// against the source file) — just validate the shape, no serial-date math needed.
function asISODate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const cells = (matrix[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (cells.some((c) => c.includes("no. pesanan"))) return i;
  }
  return 5;
}

export function parseFinanceMatrix(matrix: unknown[][]): FinanceParsed {
  const username = cell(matrix[1], 0) || null;
  const periodeStart = asISODate(matrix[1]?.[1]);
  const periodeEnd = asISODate(matrix[1]?.[2]);

  const headerIdx = findHeaderRow(matrix);
  const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const idx = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const cOrderNo   = idx("No. Pesanan");
  const cBuyer     = idx("Username (Pembeli)");
  const cPayment   = idx("Metode pembayaran pembeli");
  const cOrderDate = idx("Waktu Pesanan Dibuat");
  const cRelease   = idx("Tanggal Dana Dilepaskan");
  const cJasaKirim = idx("Jasa Kirim");
  const cKurir     = idx("Nama Kurir");

  const cSales     = idx("Harga Asli Produk");
  const cDiskonProduk    = idx("Total Diskon Produk");
  const cRefund          = idx("Jumlah Pengembalian Dana ke Pembeli");
  const cDiskonShopee    = idx("Diskon Produk dari Shopee");
  const cVoucherPenjual  = idx("Voucher disponsor oleh Penjual");
  const cVoucherCofund   = idx("Voucher co-fund disponsor oleh Penjual");
  const cCashbackKoin    = idx("Cashback Koin disponsori Penjual");
  const cCashbackCofund  = idx("Cashback Koin Co-fund disponsori Penjual");

  const cOngkirBuyer     = idx("Ongkir Dibayar Pembeli");
  const cDiskonOngkir    = idx("Diskon Ongkir Ditanggung Jasa Kirim");
  const cGratisOngkir    = idx("Gratis Ongkir dari Shopee");
  const cOngkirDiteruskan= idx("Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim");
  const cOngkosPengembalian = idx("Ongkos Kirim Pengembalian Barang");
  const cKembaliBiaya    = idx("Kembali ke Biaya Pengiriman Pengirim");
  const cPengembalianBiaya = idx("Pengembalian Biaya Kirim");

  const cKomisiAms       = idx("Biaya Komisi AMS");             // W — Affiliate Cost
  const cAdministrasi    = idx("Biaya Administrasi");           // X
  const cLayanan         = idx("Biaya Layanan");                // Y
  const cProsesPesanan   = idx("Biaya Proses Pesanan");         // Z
  const cPremi           = idx("Premi");                        // AA
  const cHematKirim      = idx("Biaya Program Hemat Biaya Kirim"); // AB
  const cTransaksi       = idx("Biaya Transaksi");              // AC
  const cKampanye        = idx("Biaya Kampanye");               // AD
  const cBeaMasuk        = idx("Bea Masuk, PPN & PPh");         // AE
  const cIsiSaldo        = idx("Biaya Isi Saldo Otomatis (dari Penghasilan)"); // AF — Misc

  const cNetIncome       = idx("Total Penghasilan"); // AG

  const num = (r: unknown[], c: number) => (c >= 0 ? toNum(r[c]) ?? 0 : 0);

  const rows: FinanceRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    if (!r.some((c) => c !== "" && c != null)) continue;
    if (cOrderNo >= 0 && !cell(r, cOrderNo)) continue; // skip stray blank/footer rows

    const promotionCost =
      num(r, cDiskonProduk) + num(r, cDiskonShopee) + num(r, cVoucherPenjual) +
      num(r, cVoucherCofund) + num(r, cCashbackKoin) + num(r, cCashbackCofund);
    const deliveryCost =
      num(r, cOngkirBuyer) + num(r, cDiskonOngkir) + num(r, cGratisOngkir) +
      num(r, cOngkirDiteruskan) + num(r, cOngkosPengembalian) + num(r, cKembaliBiaya) + num(r, cPengembalianBiaya);
    const marketplaceFee =
      num(r, cAdministrasi) + num(r, cLayanan) + num(r, cProsesPesanan) + num(r, cPremi) +
      num(r, cHematKirim) + num(r, cTransaksi) + num(r, cKampanye) + num(r, cBeaMasuk);

    const raw: Record<string, unknown> = {};
    headers.forEach((h, hi) => { if (h) raw[h] = r[hi] ?? null; });

    rows.push({
      order_no: cOrderNo >= 0 ? cell(r, cOrderNo) : null,
      buyer_username: cBuyer >= 0 ? cell(r, cBuyer) : null,
      payment_method: cPayment >= 0 ? cell(r, cPayment) : null,
      order_date: cOrderDate >= 0 ? asISODate(r[cOrderDate]) : null,
      release_date: cRelease >= 0 ? asISODate(r[cRelease]) : null,
      sales: cSales >= 0 ? toNum(r[cSales]) : null,
      promotion_cost: promotionCost,
      refund: num(r, cRefund),
      delivery_cost: deliveryCost,
      affiliate_cost: num(r, cKomisiAms),
      marketplace_fee: marketplaceFee,
      misc: num(r, cIsiSaldo),
      net_income: cNetIncome >= 0 ? toNum(r[cNetIncome]) : null,
      jasa_kirim: cJasaKirim >= 0 ? cell(r, cJasaKirim) || null : null,
      nama_kurir: cKurir >= 0 ? cell(r, cKurir) || null : null,
      raw,
    });
  }

  return { username, periodeStart, periodeEnd, rows };
}

const MONTHS_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// "Week N of <month>" = days (N-1)*7+1 .. N*7 counted from day 1 of the
// UPLOAD'S chosen month (not the calendar month the date literally falls
// in) — Week 5 naturally spills into the next calendar month, and stays
// attributed to the chosen month's week grid. Matches the same
// Monday-Sunday weekly cadence used across the rest of the app whenever
// day 1 of the month is itself a Monday.
export function weekOfMonth(releaseDateISO: string | null, year: number, monthName: string): string | null {
  if (!releaseDateISO) return null;
  const mIdx = MONTHS_ID.indexOf(monthName);
  if (mIdx < 0) return null;
  const first = Date.UTC(year, mIdx, 1);
  const rel = new Date(releaseDateISO + "T00:00:00Z").getTime();
  const dayOffset = Math.floor((rel - first) / 86400000) + 1;
  if (dayOffset < 1 || dayOffset > 35) return null; // outside this month's 5-week grid
  return `Week ${Math.ceil(dayOffset / 7)}`;
}
