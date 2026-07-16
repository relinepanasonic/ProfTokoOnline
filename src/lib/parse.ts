// NOTE: brand/category are no longer DERIVED from the product name. This is a
// multi-brand UMKM app — the authoritative brand is the one the uploader picks
// in the Owner→Brand→Store dropdown (manual.brand). "Tipe Produk" (category)
// detection was removed entirely. The old name-based BRAND_LIST/CATEGORY_LIST
// detection (a Panasonic-appliance leftover from the GAS app) tagged everything
// as "Others"/"AQUA"/"Gea", which was wrong for every store here.

// Mimic BigQuery's column-name sanitization (kept so raw keys match the old data).
export function bqCol(h: unknown): string {
  return String(h).trim().replace(/[^A-Za-z0-9]/g, "_");
}

// Parse Indonesian-formatted / messy numeric strings to a number or null.
// Handles "1.234.567,89" (id-decimal), "1.234.567" (id-integer, dots=thousands),
// "246.800" (id-integer single dot, 3 trailing digits), and "1,234.56" (en).
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");
  const dotCount  = (s.match(/\./g) || []).length;
  if (lastComma > lastDot) {
    // Indonesian with decimal: "1.234,56" — dots=thousands, comma=decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1 || (dotCount === 1 && lastComma === -1 && /\.\d{3}$/.test(s))) {
    // Multiple dots ("1.667.500") OR single dot with exactly 3 trailing digits ("246.800")
    // and no comma → Indonesian thousands separator, not decimal
    s = s.replace(/\./g, "");
  } else {
    // English decimal: "1,234.56" — drop commas
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
  brand?: string;       // auto-filled from store_links when store is picked
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
  // Brand follows the uploader's Owner→Brand→Store selection, not the product
  // name. Category ("Tipe Produk") is no longer derived at all.
  const brand = manual.brand ?? null;
  const product_type = null;

  // SPOS parent-row rule: count only rows where traffic (visitors) is present.
  // Column letter first (position AB), name as fallback — header text isn't
  // reliably consistent across SPOS export variants (same issue found in Ads).
  const visitorsSpos = toNum(get("__COL_AB")) ?? toNum(get("Pengunjung Produk (Kunjungan)"));
  const isParent =
    source === "spos" ? visitorsSpos !== null && visitorsSpos !== undefined : true;

  // Source-specific metric mapping.
  let sales_idr: number | null = null;
  let orders: number | null = null;
  let units: number | null = null;
  let visitors: number | null = null;
  let ad_cost: number | null = null;
  let in_cart: number | null = null;
  // Added 2026-07 (migration 0042) — only populated for SPOS/Ads rows
  // uploaded from here on; historical rows stay null (raw is empty on
  // every pre-existing row, so there is nothing to backfill from).
  let product_views: number | null = null;      // SPOS K  "Jumlah Produk Dilihat"
  let orders_ready: number | null = null;        // SPOS Q  "Pesanan Siap Dikirim" (true transaction count)
  let orders_created: number | null = null;      // SPOS T  "Total Pembeli (Pesanan Dibuat)" (funnel stage 3)
  let visitor_cart_adds: number | null = null;   // SPOS AH "Pengunjung Produk (Menambahkan Produk ke Keranjang)"
  let clicks: number | null = null;              // Ads "Jumlah Klik"
  let add_to_cart: number | null = null;         // Ads "Add to Cart"
  let ad_type: string | null = null;             // Ads D "Jenis Iklan" — "Product Ad" for real
                                                  // product campaigns; empty/null for shop-wide
                                                  // auto campaigns like "Shop GMV Max".
  let kode_produk: string | null = null;         // Ads E "Kode Produk" — "-" or empty for
                                                  // campaign/group-total rows, a real product
                                                  // code for individual non-grouped product ads.

  // Shopee exports the SAME report in whatever language the seller's account
  // is set to — column ORDER is identical across languages, only the header
  // text changes. So every metric is read by Indonesian header name first,
  // then falls back to the fixed column LETTER, which makes the parser
  // bilingual (handles English "Sales (Confirmed Order) (IDR)" exports too).
  if (source === "spos") {
    // "Siap Dikirim" (Ready to Ship) = English "Confirmed Order". Fixed
    // positions (verified against real ID + EN exports): J sales, S units,
    // K product_views, Q orders_ready, T orders_created, U orders,
    // AB visitors, AH cart-adds, AI in-cart.
    sales_idr = toNum(get("Penjualan (Pesanan Siap Dikirim) (IDR)")) ?? toNum(get("__COL_J"));
    orders    = toNum(get("__COL_U")) ?? toNum(get("Total Pembeli (Pesanan Siap Dikirim)"));
    units     = toNum(get("Produk Terjual (Pesanan Siap Dikirim)"))
             ?? toNum(get("Produk (Pesanan Siap Dikirim)")) ?? toNum(get("__COL_S"));
    visitors  = visitorsSpos;
    in_cart   = toNum(get("Dimasukkan ke Keranjang (Produk)")) ?? toNum(get("__COL_AI"));
    product_views     = toNum(get("__COL_K")) ?? toNum(get("Jumlah Produk Dilihat"));
    orders_ready      = toNum(get("__COL_Q")) ?? toNum(get("Pesanan Siap Dikirim"));
    orders_created    = toNum(get("__COL_T")) ?? toNum(get("Total Pembeli (Pesanan Dibuat)"));
    visitor_cart_adds = toNum(get("__COL_AH")) ?? toNum(get("Pengunjung Produk (Menambahkan Produk ke Keranjang)"));
  } else if (source === "ads") {
    // Fixed positions (EN export): K impressions, L clicks, N add-to-cart,
    // P conversions, V items, X GMV, Z expense.
    sales_idr = toNum(get("Omzet Penjualan")) ?? toNum(get("__COL_X"));
    orders    = toNum(get("Konversi")) ?? toNum(get("__COL_P"));
    units     = toNum(get("Produk Terjual")) ?? toNum(get("__COL_V"));
    visitors  = toNum(get("Dilihat")) ?? toNum(get("__COL_K"));
    ad_cost   = toNum(get("Biaya")) ?? toNum(get("__COL_Z"));
    clicks       = toNum(get("__COL_L")) ?? toNum(get("Jumlah Klik"));
    add_to_cart  = toNum(get("__COL_N")) ?? toNum(get("Add to Cart"));
    { const v = get("__COL_D") ?? get("Jenis Iklan") ?? get("Ads Type"); ad_type = v != null && v !== "" ? String(v).trim() : null; }
    {
      const v = get("__COL_E") ?? get("Kode Produk");
      const s = v != null ? String(v).trim() : "";
      kode_produk = s && s !== "-" ? s : null;
    }
  } else {
    // perf ("Tinjauan Penjualan" / Sales Overview) — EN positions:
    // B visitors, E buyers, F sales.
    sales_idr = toNum(get("Penjualan (Pesanan Siap Dikirim) (IDR)")) ?? toNum(get("__COL_F"));
    orders    = toNum(get("Total Pembeli (Pesanan Siap Dikirim)")) ?? toNum(get("__COL_E"));
    units     = toNum(get("Total Produk Dipesan"));
    visitors  = toNum(get("Total Pengunjung (Kunjungan)")) ?? toNum(get("__COL_B"));
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
    product_views,
    orders_ready,
    orders_created,
    visitor_cart_adds,
    clicks,
    add_to_cart,
    ad_type,
    kode_produk,
    is_parent: isParent,
    raw,
  };
}
