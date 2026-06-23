// Ported from the GAS Upload.gs brand/category detection — behaviour-identical.

export const BRAND_LIST = [
  "Panasonic", "Sharp", "Polytron", "Gree", "Daikin", "LG", "Samsung", "Midea",
  "Modena", "Bosch", "Electrolux", "Beko", "Hitachi", "Ariston", "Gea", "Philips",
  "Toshiba", "TCL", "Reiwa", "AQUA", "Xiaomi", "Teka", "Changhong", "Mitsubishi",
];

// Multi-word phrases first so the more specific one wins; "AC" last & boundary-safe.
export const CATEGORY_LIST = [
  "Mesin Cuci", "Kipas Angin", "Hair Dryer", "Rice Cooker", "Water Heater",
  "Magic Com", "Kulkas", "Dispenser", "Blender", "Setrika", "Frezzer", "Fan", "TV", "AC",
];

// Case-insensitive whole-word regex; \b means "AC" won't match inside "Hitachi".
function wordRe(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + esc + "\\b", "i");
}

export function detectBrand(name: unknown): string {
  const s = String(name ?? "");
  if (/non\s*panasonic|bukan\s*panasonic/i.test(s)) return "Others";
  for (const b of BRAND_LIST) if (wordRe(b).test(s)) return b;
  return "Others";
}

export function detectCategory(name: unknown): string {
  const s = String(name ?? "");
  for (const c of CATEGORY_LIST) if (wordRe(c).test(s)) return c;
  return "Others";
}

// Mimic BigQuery's column-name sanitization (kept so raw keys match the old data).
export function bqCol(h: unknown): string {
  return String(h).trim().replace(/[^A-Za-z0-9]/g, "_");
}

// Parse Indonesian-formatted / messy numeric strings to a number or null.
// Handles "1.234.567,89" (id) and "1,234,567.89" (en) and stray currency text.
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    // comma is decimal separator (id) -> drop dots, comma -> dot
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // dot is decimal separator (en) -> drop commas
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type DataSource = "spos" | "ads" | "perf";

// The shared manual fields entered once per upload (same for the whole file).
export interface ManualFields {
  admin?: string;
  bulan?: string;          // data month name
  baseline_month?: string; // "Bulan Awal" baseline month for dashboard comparison
  year?: number;
  city?: string;
  pic_client?: string;  // was "PIC Panasonic"
  store_name?: string;  // was "Dealer"
  week?: string;
  tanggal_mulai?: string;    // Monday — start of the data week
  tanggal_berakhir?: string; // Sunday — auto = tanggal_mulai + 6 days
  tanggal_input?: string;    // ISO timestamp when the upload was entered (log)
  tanggal?: string;
}

// Which raw column holds the name we derive brand/category from, per source.
const NAME_COL: Record<DataSource, string | null> = {
  spos: "Produk",
  ads: "Nama Iklan",
  perf: null, // Performa has neither brand nor category
};

// Map a parsed raw row -> the typed sales_rows fields. Metric extraction picks
// the best-matching Shopee column per source; raw keeps everything verbatim.
export function mapRow(
  source: DataSource,
  raw: Record<string, unknown>,
  manual: ManualFields
) {
  const get = (k: string) => raw[k] ?? raw[bqCol(k)];

  const nameCol = NAME_COL[source];
  const name = nameCol ? get(nameCol) : null;
  const brand = nameCol ? detectBrand(name) : null;
  const product_type = nameCol ? detectCategory(name) : null;

  // SPOS parent-row rule: count only rows where traffic (visitors) is present.
  const visitorsSpos = toNum(get("Pengunjung Produk (Kunjungan)"));
  const isParent =
    source === "spos" ? visitorsSpos !== null && visitorsSpos !== undefined : true;

  // Source-specific metric mapping.
  let sales_idr: number | null = null;
  let orders: number | null = null;
  let units: number | null = null;
  let visitors: number | null = null;
  let ad_cost: number | null = null;
  let in_cart: number | null = null;

  if (source === "spos") {
    sales_idr = toNum(get("Total Penjualan (Pesanan Dibuat) (IDR)"));
    orders = toNum(get("Total Pembeli (Pesanan Dibuat)"));
    units = toNum(get("Produk (Pesanan Dibuat)"));
    visitors = visitorsSpos;
    in_cart = toNum(get("Dimasukkan ke Keranjang (Produk)"));
  } else if (source === "ads") {
    sales_idr = toNum(get("Omzet Penjualan"));
    orders = toNum(get("Konversi"));
    units = toNum(get("Produk Terjual"));
    visitors = toNum(get("Dilihat"));
    ad_cost = toNum(get("Biaya"));
  } else {
    // perf
    sales_idr = toNum(get("Penjualan (Pesanan Dibuat) (IDR)"));
    orders = toNum(get("Total Pembeli (Pesanan Dibuat)"));
    units = toNum(get("Total Produk Dipesan"));
    visitors = toNum(get("Total Pengunjung (Kunjungan)"));
  }

  return {
    source,
    year: manual.year ?? null,
    month: manual.bulan ?? null,
    week: manual.week ?? null,
    city: manual.city ?? null,
    store_name: manual.store_name ?? null,
    pic_client: manual.pic_client ?? null,
    brand,
    product_type,
    item_name: name != null ? String(name) : null,
    tanggal: manual.tanggal || manual.tanggal_mulai || null,
    sales_idr,
    orders,
    units,
    visitors,
    ad_cost,
    in_cart,
    is_parent: isParent,
    raw,
  };
}
