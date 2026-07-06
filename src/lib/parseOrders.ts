// Parser for the Shopee "Order.completed" (order-level) export used by the
// Store Performance page. One row per order line-item — an order can span
// several rows (one per SKU/variant), so order-level KPIs must always count
// DISTINCT "No. Pesanan", never row count.
//
// Header row verified against a real export (1665 rows / 1290 distinct
// orders, June 2026): the sheet's own column order matches Shopee's column
// letters exactly — "Pesanan Harus Dikirimkan Sebelum..." sits at column I,
// "Waktu Pembayaran Dilakukan" at column L, "Waktu Pesanan Selesai" at the
// last column, AX.
import { toNum } from "./parse";

export interface OrderRow {
  order_no: string | null;
  order_type: string | null;
  order_status: string | null;
  cancel_return_status: string | null;
  tracking_no: string | null;
  shipping_option: string | null;
  ship_deadline: string | null;    // Pesanan Harus Dikirimkan Sebelum (I)
  order_created_at: string | null; // Waktu Pesanan Dibuat
  paid_at: string | null;          // Waktu Pembayaran Dilakukan (L)
  payment_method: string | null;
  product_name: string | null;
  variant_name: string | null;
  qty: number | null;              // Jumlah
  returned_qty: number | null;     // Returned quantity
  total_payment: number | null;    // Total Pembayaran (order-level GMV, repeated per line)
  buyer_username: string | null;
  city: string | null;             // Kota/Kabupaten
  province: string | null;
  completed_at: string | null;     // Waktu Pesanan Selesai (AX)
  raw: Record<string, unknown>;
}

// Excel gives plain "yyyy-mm-dd hh:mm" strings for this report (raw:false at
// parse time) — just validate the shape, no serial-date math needed.
function asTimestamp(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null;
}
function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export function parseOrdersMatrix(matrix: unknown[][]): OrderRow[] {
  if (!matrix.length) return [];
  const header = (matrix[0] || []).map((h) => String(h ?? "").trim());
  const idx = (name: string) => header.indexOf(name);

  const iOrderNo = idx("No. Pesanan");
  const iOrderType = idx("Tipe Pesanan");
  const iOrderStatus = idx("Status Pesanan");
  const iCancelStatus = idx("Status Pembatalan/ Pengembalian");
  const iTracking = idx("No. Resi");
  const iShipOption = idx("Opsi Pengiriman");
  const iShipDeadline = idx("Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)");
  const iOrderCreated = idx("Waktu Pesanan Dibuat");
  const iPaidAt = idx("Waktu Pembayaran Dilakukan");
  const iPayMethod = idx("Metode Pembayaran");
  const iProduct = idx("Nama Produk");
  const iVariant = idx("Nama Variasi");
  const iQty = idx("Jumlah");
  const iReturnedQty = idx("Returned quantity");
  const iTotalPayment = idx("Total Pembayaran");
  const iBuyer = idx("Username (Pembeli)");
  const iCity = idx("Kota/Kabupaten");
  const iProvince = idx("Provinsi");
  const iCompleted = idx("Waktu Pesanan Selesai");

  if (iOrderNo < 0 || iCompleted < 0) return []; // not this export type

  const rows: OrderRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    if (!row.some((c) => c !== "" && c != null)) continue;
    const raw: Record<string, unknown> = {};
    header.forEach((h, i) => { if (h) raw[h] = row[i]; });
    rows.push({
      order_no: str(row[iOrderNo]),
      order_type: str(row[iOrderType]),
      order_status: str(row[iOrderStatus]),
      cancel_return_status: str(row[iCancelStatus]),
      tracking_no: str(row[iTracking]),
      shipping_option: str(row[iShipOption]),
      ship_deadline: asTimestamp(row[iShipDeadline]),
      order_created_at: asTimestamp(row[iOrderCreated]),
      paid_at: asTimestamp(row[iPaidAt]),
      payment_method: str(row[iPayMethod]),
      product_name: str(row[iProduct]),
      variant_name: str(row[iVariant]),
      qty: toNum(row[iQty]),
      returned_qty: toNum(row[iReturnedQty]),
      total_payment: toNum(row[iTotalPayment]),
      buyer_username: str(row[iBuyer]),
      city: str(row[iCity]),
      province: str(row[iProvince]),
      completed_at: asTimestamp(row[iCompleted]),
      raw,
    });
  }
  return rows;
}
