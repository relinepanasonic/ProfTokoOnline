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

export interface FinanceRow {
  order_no: string | null;
  buyer_username: string | null;
  payment_method: string | null;
  order_date: string | null;   // ISO yyyy-mm-dd
  release_date: string | null; // ISO yyyy-mm-dd
  sales: number | null;
  discount_voucher: number | null;
  refund: number | null;
  shipping_net: number | null;
  marketplace_fee: number | null;
  net_income: number | null;
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

  const cKomisiAms       = idx("Biaya Komisi AMS");
  const cAdministrasi    = idx("Biaya Administrasi");
  const cLayanan         = idx("Biaya Layanan");
  const cProsesPesanan   = idx("Biaya Proses Pesanan");
  const cPremi           = idx("Premi");
  const cHematKirim      = idx("Biaya Program Hemat Biaya Kirim");
  const cTransaksi       = idx("Biaya Transaksi");
  const cKampanye        = idx("Biaya Kampanye");
  const cIsiSaldo        = idx("Biaya Isi Saldo Otomatis (dari Penghasilan)");

  const cNetIncome       = idx("Total Penghasilan");

  const num = (r: unknown[], c: number) => (c >= 0 ? toNum(r[c]) ?? 0 : 0);

  const rows: FinanceRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    if (!r.some((c) => c !== "" && c != null)) continue;
    if (cOrderNo >= 0 && !cell(r, cOrderNo)) continue; // skip stray blank/footer rows

    const discountVoucher = Math.abs(
      num(r, cDiskonProduk) + num(r, cDiskonShopee) + num(r, cVoucherPenjual) +
      num(r, cVoucherCofund) + num(r, cCashbackKoin) + num(r, cCashbackCofund)
    );
    const shippingNet =
      num(r, cOngkirBuyer) + num(r, cDiskonOngkir) + num(r, cGratisOngkir) +
      num(r, cOngkirDiteruskan) + num(r, cOngkosPengembalian) + num(r, cKembaliBiaya) + num(r, cPengembalianBiaya);
    const marketplaceFee = Math.abs(
      num(r, cKomisiAms) + num(r, cAdministrasi) + num(r, cLayanan) + num(r, cProsesPesanan) +
      num(r, cPremi) + num(r, cHematKirim) + num(r, cTransaksi) + num(r, cKampanye) + num(r, cIsiSaldo)
    );

    const raw: Record<string, unknown> = {};
    headers.forEach((h, hi) => { if (h) raw[h] = r[hi] ?? null; });

    rows.push({
      order_no: cOrderNo >= 0 ? cell(r, cOrderNo) : null,
      buyer_username: cBuyer >= 0 ? cell(r, cBuyer) : null,
      payment_method: cPayment >= 0 ? cell(r, cPayment) : null,
      order_date: cOrderDate >= 0 ? asISODate(r[cOrderDate]) : null,
      release_date: cRelease >= 0 ? asISODate(r[cRelease]) : null,
      sales: cSales >= 0 ? toNum(r[cSales]) : null,
      discount_voucher: discountVoucher,
      refund: Math.abs(num(r, cRefund)),
      shipping_net: shippingNet,
      marketplace_fee: marketplaceFee,
      net_income: cNetIncome >= 0 ? toNum(r[cNetIncome]) : null,
      jasa_kirim: cJasaKirim >= 0 ? cell(r, cJasaKirim) || null : null,
      nama_kurir: cKurir >= 0 ? cell(r, cKurir) || null : null,
      raw,
    });
  }

  return { username, periodeStart, periodeEnd, rows };
}
