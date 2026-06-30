// Parser for the Shopee "Data Grup Iklan" export (Laporan Grup).
// Structure of the file (CSV or xlsx):
//   row 0: "Grup Iklan - Laporan <GRUP NAME> - Shopee Indonesia"
//   row 1: "Username,<username>"
//   row 2: "Nama Toko,<store>"
//   row 3: "ID Toko,<id>"
//   row 4: "Waktu Laporan Dibuat,<ts>"
//   row 5: "Periode,<dd/mm/yyyy - dd/mm/yyyy>"
//   row 6: (blank)
//   row 7: header  -> Urutan,Nama Iklan/Produk,Kode Produk,…,Biaya,Efektifitas Iklan,…
//   row 8: the GROUP total line (Nama = grup name, Kode Produk = "-")
//   row 9+: individual product lines inside the group
import { toNum } from "./parse";

export interface AdGroupManual {
  year?: number;
  bulan?: string;       // month name
  week?: string;
  pic_client?: string;  // owner
  store_name?: string;
  brand?: string;
  admin?: string;
  tanggal_input?: string;
}

export interface AdGroupParsed {
  grupIklan: string | null;
  username: string | null;
  namaToko: string | null;
  periodeStart: string | null; // ISO yyyy-mm-dd
  periodeEnd: string | null;
  rows: AdGroupRow[];
}

export interface AdGroupRow {
  grup_iklan: string | null;
  level: "group" | "product";
  item_name: string | null;
  kode_produk: string | null;
  dilihat: number | null;
  klik: number | null;
  konversi: number | null;
  konversi_langsung: number | null;
  produk_terjual: number | null;
  terjual_langsung: number | null;
  omzet: number | null;
  penjualan_langsung: number | null;
  biaya: number | null;
  roas: number | null;
  roas_langsung: number | null;
  raw: Record<string, unknown>;
}

// dd/mm/yyyy -> yyyy-mm-dd
function idDateToISO(s: string): string | null {
  const m = String(s || "").trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function cell(row: unknown[], i: number): string {
  return String(row?.[i] ?? "").trim();
}

// Find the header row: the one that contains "Nama Iklan/Produk".
function findHeader(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const cells = (matrix[i] || []).map((c) => String(c ?? "").toLowerCase());
    if (cells.some((c) => c.includes("nama iklan"))) return i;
  }
  return 7;
}

export function parseAdGroupMatrix(matrix: unknown[][]): AdGroupParsed {
  // --- preamble extraction (label,value pairs in the first rows) ---
  let grupIklan: string | null = null;
  let username: string | null = null;
  let namaToko: string | null = null;
  let periodeStart: string | null = null;
  let periodeEnd: string | null = null;

  const headerIdx = findHeader(matrix);

  for (let i = 0; i < headerIdx; i++) {
    const a = cell(matrix[i], 0);
    const b = cell(matrix[i], 1);
    const low = a.toLowerCase();
    // title row holds the grup name: "Grup Iklan - Laporan Grup Hero - Shopee Indonesia"
    const titleMatch = a.match(/laporan\s+(.+?)\s+-\s+shopee/i);
    if (titleMatch) grupIklan = titleMatch[1].trim();
    if (low.startsWith("username")) username = b || null;
    if (low.startsWith("nama toko")) namaToko = b || null;
    if (low.startsWith("periode")) {
      const parts = b.split(/\s*-\s*/);
      periodeStart = idDateToISO(parts[0] || "");
      periodeEnd = idDateToISO(parts[1] || "");
    }
  }

  // --- header + data ---
  const headers = (matrix[headerIdx] || []).map((h) => String(h ?? "").trim());
  const idx = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const idxIncl = (frag: string) =>
    headers.findIndex((h) => h.toLowerCase().includes(frag.toLowerCase()));

  const cName     = idxIncl("nama iklan");
  const cKode     = idxIncl("kode produk");
  const cDilihat  = idx("Dilihat");
  const cKlik     = idxIncl("jumlah klik");
  const cKonv     = idx("Konversi");
  const cKonvL    = idx("Konversi Langsung");
  const cTerjual  = idxIncl("produk terjual");
  const cTerjualL = idx("Terjual Langsung");
  const cOmzet    = idxIncl("omzet penjualan");
  const cPenjL    = idxIncl("penjualan langsung");
  const cBiaya    = idx("Biaya");
  const cEfekt    = idxIncl("efektifitas iklan");
  const cEfektL   = idxIncl("efektivitas langsung");

  const rows: AdGroupRow[] = [];
  const groupNameLower = (grupIklan || "").toLowerCase();

  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    // skip fully-blank rows (and a possible second stacked table)
    if (!r.some((c) => c !== "" && c != null)) continue;

    const name = cName >= 0 ? cell(r, cName) : "";
    const kode = cKode >= 0 ? cell(r, cKode) : "";
    if (!name) continue;

    // group total row: Kode Produk is "-" or empty, or name == the grup name
    const isGroup =
      kode === "-" || kode === "" || name.toLowerCase() === groupNameLower;

    const raw: Record<string, unknown> = {};
    headers.forEach((h, hi) => { if (h) raw[h] = r[hi] ?? null; });

    rows.push({
      grup_iklan: grupIklan,
      level: isGroup ? "group" : "product",
      item_name: name,
      kode_produk: kode || null,
      dilihat:            cDilihat  >= 0 ? toNum(r[cDilihat])  : null,
      klik:               cKlik     >= 0 ? toNum(r[cKlik])     : null,
      konversi:           cKonv     >= 0 ? toNum(r[cKonv])     : null,
      konversi_langsung:  cKonvL    >= 0 ? toNum(r[cKonvL])    : null,
      produk_terjual:     cTerjual  >= 0 ? toNum(r[cTerjual])  : null,
      terjual_langsung:   cTerjualL >= 0 ? toNum(r[cTerjualL]) : null,
      omzet:              cOmzet    >= 0 ? toNum(r[cOmzet])    : null,
      penjualan_langsung: cPenjL    >= 0 ? toNum(r[cPenjL])    : null,
      biaya:              cBiaya    >= 0 ? toNum(r[cBiaya])    : null,
      roas:               cEfekt    >= 0 ? toNum(r[cEfekt])    : null,
      roas_langsung:      cEfektL   >= 0 ? toNum(r[cEfektL])   : null,
      raw,
    });
  }

  return { grupIklan, username, namaToko, periodeStart, periodeEnd, rows };
}
