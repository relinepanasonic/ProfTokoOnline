// Parser for the "Market Place Fee" sheet/CSV (Calculator E-Commerce fee
// list): Category > Sub Category > Jenis Product, per Platform + Jenis
// Toko. Column position varies (the Google Sheet export has a leading
// blank column A; a plain CSV export may not) — always resolved by header
// text, never a fixed letter, so both sources parse identically.
export interface MarketFeeRow {
  category: string;
  sub_category: string;
  jenis_product: string;
  platform: string;
  jenis_toko: string;
  platform_fee: number | null;
  biaya_proses_pesanan: number | null;
  biaya_layanan_mall: number | null;
  kategori_kirim: string | null;
  min_go_biasa: number | null;
  max_go_biasa: number | null;
  min_go_khusus: number | null;
  max_go_khusus: number | null;
  min_promo_xtra: number | null;
  max_promo_xtra: number | null;
  spaylater_3mo: number | null;
  spaylater_6mo: number | null;
}

export const EDITABLE_FEE_FIELDS = [
  "platform_fee", "biaya_proses_pesanan", "biaya_layanan_mall",
  "min_go_biasa", "max_go_biasa", "min_go_khusus", "max_go_khusus",
  "min_promo_xtra", "max_promo_xtra", "spaylater_3mo", "spaylater_6mo",
] as const;

// This source formats fee cells in plain en-US style ("Rp1,250" = 1250,
// "9.00%" = 9, "Rp100,000,000,000" = 1e11) — commas are thousands
// separators here, not decimals. Do NOT reuse src/lib/parse.ts's toNum(),
// which assumes the opposite (Indonesian) convention and would mis-parse
// "1,250" as 1.25.
function parseFeeNum(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function parseMarketFeeMatrix(matrix: unknown[][]): MarketFeeRow[] {
  // Header row is whichever of the first few rows contains "Category" —
  // handles both the sheet export's blank row 0 + header row 1 layout and
  // a plain CSV's row 0 header.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 5); i++) {
    if ((matrix[i] || []).some((c) => str(c) === "Category")) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const header = (matrix[headerIdx] || []).map((h) => str(h));
  const idx = (name: string) => header.indexOf(name);
  const iCat = idx("Category"), iSub = idx("Sub Category"), iProd = idx("Jenis Product");
  const iPlat = idx("Platform"), iToko = idx("Jenis Toko");
  const iFee = idx("Platform Fee"), iProses = idx("Biaya Proses Pesanan"), iMall = idx("Biaya Layanan Mall");
  const iKirim = idx("Kategori Kirim");
  const iMinB = idx("Min Gratis Ongkir Uk Biasa"), iMaxB = idx("Max Gratis Ongkir Uk Biasa");
  const iMinK = idx("Min Gratis Ongkir Uk Khusus"), iMaxK = idx("Max Gratis Ongkir Uk Khusus");
  const iMinP = idx("Min Promo Xtra | XBP"), iMaxP = idx("Max Promo Xtra | XBP");
  const iSp3 = idx("Spay Later Xtra 3 mo"), iSp6 = idx("Spay Later Xtra 6 mo");
  if (iCat < 0 || iSub < 0 || iProd < 0) return [];

  const rows: MarketFeeRow[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const category = str(row[iCat]);
    if (!category) continue; // blank/junk trailer rows
    rows.push({
      category,
      sub_category: str(row[iSub]),
      jenis_product: str(row[iProd]),
      platform: str(row[iPlat]),
      jenis_toko: str(row[iToko]),
      platform_fee: parseFeeNum(row[iFee]),
      biaya_proses_pesanan: parseFeeNum(row[iProses]),
      biaya_layanan_mall: parseFeeNum(row[iMall]),
      kategori_kirim: str(row[iKirim]) || null,
      min_go_biasa: parseFeeNum(row[iMinB]),
      max_go_biasa: parseFeeNum(row[iMaxB]),
      min_go_khusus: parseFeeNum(row[iMinK]),
      max_go_khusus: parseFeeNum(row[iMaxK]),
      min_promo_xtra: parseFeeNum(row[iMinP]),
      max_promo_xtra: parseFeeNum(row[iMaxP]),
      spaylater_3mo: parseFeeNum(row[iSp3]),
      spaylater_6mo: parseFeeNum(row[iSp6]),
    });
  }
  return rows;
}

export function marketFeeKey(r: { category: string; sub_category: string; jenis_product: string; platform: string; jenis_toko: string }): string {
  return [r.category, r.sub_category, r.jenis_product, r.platform, r.jenis_toko].join("::");
}
