import { describe, expect, it } from "vitest";
import { isIncomeSkuMatrix, parseIncomeSkuMatrix, parseIncomeSummary } from "./parseIncomeSku";

// Miniature copy of Shopee's "Penghasilan" sheet: 3 header rows, then an
// Order row followed by its Sku rows. Includes a fee column that exists in
// only some exports ("Biaya Layanan Promo XTRA+") and a trailing second
// "Pajak" group (tax BASE columns) that must NOT be counted as a cost.
const GROUPS = ["", "", "", "", "", "", "", "", "", "",
  "Total Penghasilan", "Subtotal Pesanan", "", "Subtotal Ongkos Kirim", "",
  "Voucher dan Potongan Harga", "Biaya Platform", "", "Biaya Gratis Ongkir XTRA",
  "Biaya Layanan", "", "Biaya Promosi", "", "", "Biaya Lainnya", "Pajak",
  "", "", "", "Pajak", ""];
const HEADERS = ["No.", "Lihat berdasarkan", "No. Pesanan", "No. Pengajuan", "ID Produk", "Nama Produk",
  "Waktu Pesanan Dibuat", "Tanggal Dana Dilepaskan", "Metode Pelepasan Dana", "Tipe Pesanan",
  "Total Penghasilan", "Harga Produk", "Jumlah Pengembalian Dana ke Pembeli",
  "Ongkos Kirim yang Dibayarkan ke Jasa Kirim", "Gratis Ongkir dari Shopee",
  "Voucher disponsor oleh Penjual",
  "Biaya Administrasi", "Biaya Proses Pesanan", "Biaya Gratis Ongkir XTRA - Ukuran Biasa (Kategori D)",
  "Biaya Transaksi", "Biaya Layanan Promo XTRA+",
  "Biaya Kampanye", "Biaya Komisi AMS", "Biaya Isi Saldo Otomatis (dari Penghasilan)",
  "Premi", "PPh 22",
  "Username (Pembeli)", "Metode pembayaran pembeli", "Jasa Kirim", "Dasar Pengenaan Pajak", "Nama Kurir"];

//                 no view   order        pj  pid    name        created       released      m  type  net  harga refund ship gratis voucher admin proses xtra trans promo kamp ams  isi  premi pph  buyer pay jasa dpp  kurir
const row = (view: string, order: string, pid: string, name: string,
  v: Parts & { net: number }) =>
  [1, view, order, "", pid, name, "2026-10-08", "2026-10-10", "Saldo Penjual", "Normal Order",
    v.net, v.harga, 0, v.ship ?? 0, v.gratis ?? 0, v.voucher ?? 0,
    v.admin, v.proses, v.xtra, v.trans, v.promo ?? 0, v.kamp ?? 0, v.ams ?? 0, v.isi ?? 0, v.premi ?? 0, v.pph,
    "buyer1", "ShopeePay", "SPX", "36499", "kurir"];

// Order A: two products. Order B: one product with an AMS commission + Isi Saldo + campaign fee.
// Total Penghasilan is computed from the parts, exactly like Shopee does.
type Parts = { harga: number; ship?: number; gratis?: number; voucher?: number; admin: number; proses: number; xtra: number; trans: number; promo?: number; kamp?: number; ams?: number; isi?: number; premi?: number; pph: number };
const withNet = (v: Parts) => ({ ...v, net: Object.entries(v).filter(([k]) => k !== "net").reduce((x, [, n]) => x + ((n as number) ?? 0), 0) });
const A1 = withNet({ harga: 100, ship: -10, gratis: 10, voucher: -5, admin: -10, proses: -2, xtra: -3, trans: -4, pph: -1 });
const A2 = withNet({ harga: 50, ship: -5, gratis: 5, admin: -8, proses: -3, xtra: -2, trans: -3, promo: -2, premi: -1, pph: -1 });
const sumParts = (x: Parts, y: Parts): Parts => {
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) out[k] = ((x as Record<string, number>)[k] ?? 0) + ((y as Record<string, number>)[k] ?? 0);
  return out as unknown as Parts;
};
const ASUM = withNet(sumParts(A1 as unknown as Parts, A2 as unknown as Parts) as Parts);
const B1 = withNet({ harga: 80, admin: -9, proses: -5, xtra: -4, trans: -6, kamp: -4, ams: -6, isi: -1, pph: -1 });

const MATRIX: unknown[][] = [
  ["Informasi Pesanan"],
  GROUPS,
  HEADERS,
  row("Order", "ORDER-A", "-", "-", ASUM),
  row("Sku", "ORDER-A", "111", "Produk Satu", A1),
  row("Sku", "ORDER-A", "222", "Produk Dua", A2),
  row("Order", "ORDER-B", "-", "-", B1),
  row("Sku", "ORDER-B", "111", "Produk Satu", B1),
  row("Sku", "ORDER-B", "-", "Tanpa ID", B1), // no product id -> must be skipped
];

describe("parseIncomeSkuMatrix", () => {
  it("detects the new layout, and not the old Income sheet", () => {
    expect(isIncomeSkuMatrix(MATRIX)).toBe(true);
    expect(isIncomeSkuMatrix([["Username (Penjual)", "x"], [], ["No. Pesanan", "Harga Asli Produk"]])).toBe(false);
  });

  it("returns one finance row per order and one sku row per product line", () => {
    const p = parseIncomeSkuMatrix(MATRIX);
    expect(p.rows.map((r) => r.order_no)).toEqual(["ORDER-A", "ORDER-B"]);
    expect(p.skuRows.map((s) => `${s.order_no}/${s.kode_produk}`)).toEqual(["ORDER-A/111", "ORDER-A/222", "ORDER-B/111"]);
    expect(p.unreconciled).toBe(0);
  });

  it("every part adds up to Total Penghasilan, for orders and sku lines", () => {
    const p = parseIncomeSkuMatrix(MATRIX);
    for (const r of p.rows) {
      const t = (r.sales ?? 0) + (r.refund ?? 0) + (r.promotion_cost ?? 0) + (r.delivery_cost ?? 0)
        + (r.affiliate_cost ?? 0) + (r.marketplace_fee ?? 0) + (r.misc ?? 0);
      expect(t).toBe(r.net_income);
    }
    for (const s of p.skuRows) {
      const t = s.sales + s.refund + s.promotion_cost + s.delivery_cost + s.affiliate_cost + s.marketplace_fee + s.misc + s.pajak;
      expect(t).toBe(s.net_income);
    }
  });

  it("a product's lines sum to its order (Shopee's own split)", () => {
    const p = parseIncomeSkuMatrix(MATRIX);
    const a = p.skuRows.filter((s) => s.order_no === "ORDER-A");
    const orderA = p.rows[0];
    expect(a.reduce((x, s) => x + s.marketplace_fee + s.pajak, 0)).toBe(orderA.marketplace_fee);
    expect(a.reduce((x, s) => x + s.pajak, 0)).toBe(orderA.pajak);
  });

  it("classifies fees by group: marketplace, affiliate (AMS), misc (Isi Saldo), pajak, delivery, promotion", () => {
    const p = parseIncomeSkuMatrix(MATRIX);
    const b = p.skuRows.find((s) => s.order_no === "ORDER-B")!;
    expect(b.affiliate_cost).toBe(-6);
    expect(b.misc).toBe(-1);
    expect(b.pajak).toBe(-1);
    expect(b.marketplace_fee).toBe(-9 - 5 - 4 - 6 - 4); // admin+proses+xtra+transaksi+kampanye, no pajak
    const a1 = p.skuRows[0];
    expect(a1.delivery_cost).toBe(0);       // -10 shipping + 10 free-shipping subsidy
    expect(a1.promotion_cost).toBe(-5);
    expect(p.skuRows[1].marketplace_fee).toBe(-8 - 3 - 2 - 3 - 2 - 1); // incl. the XTRA+ layanan column and Premi
  });

  it("keeps pajak inside the order's marketplace_fee (so finance_summary still reconciles) and also reports it", () => {
    const p = parseIncomeSkuMatrix(MATRIX);
    const orderB = p.rows[1];
    expect(orderB.pajak).toBe(-1);
    expect(orderB.marketplace_fee).toBe(-9 - 5 - 4 - 6 - 4 + -1);
  });

  it("ignores the tax-base columns after the money block", () => {
    const p = parseIncomeSkuMatrix(MATRIX);
    expect(p.rows[0].sales).toBe(150); // not inflated by the 36499 'Dasar Pengenaan Pajak'
  });

  it("flags orders whose parts do not add up", () => {
    const broken = MATRIX.map((r) => r.slice());
    broken[3][10] = 9999; // wrong net on ORDER-A
    expect(parseIncomeSkuMatrix(broken).unreconciled).toBe(1);
  });
});

describe("parseIncomeSummary", () => {
  it("reads username and period from the Summary sheet", () => {
    expect(parseIncomeSummary([["Laporan Penghasilan"], ["Username (Penjual)", "japarutomo"], ["Dari", "2026-10-10"], ["ke", "2026-10-11"]]))
      .toEqual({ username: "japarutomo", periodeStart: "2026-10-10", periodeEnd: "2026-10-11" });
  });
});
