// Client-side OCR for the Shopee "Iklan Produk Otomatis" screenshot —
// tesseract.js (WASM, runs in the browser, no AI vision API / no
// per-request billing), plus a table-layout reconstruction heuristic on
// top of its word-level bounding boxes.
//
// Tesseract gives us a flat bag of words with positions — it has no idea
// there's a table there. We rebuild the table ourselves:
//   1. Find the header row by matching known Indonesian column labels,
//      and use each match's x-center as that column's anchor.
//   2. Cluster every word BELOW the header into rows by y-proximity.
//   3. Within each row, assign every word to its nearest column anchor
//      by x-distance, then join same-column words into a cell string.
//   4. For numeric columns, take the first non-delta numeric token (a
//      value line like "3.7k" or "Rp478.608", not a delta line like
//      "+35,1%" or "-2,8%") — those render as a second line directly
//      under the real value in Shopee's own UI.
//
// This is inherently imperfect on a screenshot this busy (thumbnails,
// colored deltas, multi-line names, checkboxes) — it is NOT a substitute
// for actually looking at the image. Callers MUST show the result as an
// editable draft for a human to review before saving, never silently.

import Tesseract from "tesseract.js";

export type OcrRow = {
  product_name: string;
  views: number | null;
  clicks: number | null;
  ad_cost: number | null;
  sales: number | null;
  conversion: number | null;
  items_sold: number | null;
};

type Word = { text: string; x0: number; x1: number; y0: number; y1: number };

// Column labels as they appear in Shopee's own UI (id-ID), matched
// case-insensitively as a substring so OCR noise around them doesn't
// break the match. Order matters: this IS the left-to-right column order.
const COLUMNS = [
  { key: "views" as const,      labels: ["iklan dilihat", "dilihat"] },
  { key: "clicks" as const,     labels: ["jumlah klik", "klik"] },
  { key: "ad_cost" as const,    labels: ["biaya iklan"] },
  { key: "sales" as const,      labels: ["penjualan"] },
  { key: "conversion" as const, labels: ["konversi"] },
  { key: "items_sold" as const, labels: ["produk terjual", "prod terjual", "terjual"] },
];

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9%.,+\-\s]/g, "").trim();
}

/** "3,7k" / "3.7k" -> 3700, "Rp478.608" -> 478608, "9,57" -> 9.57 */
function parseNumericToken(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const isDelta = /^[+\-]/.test(s) || s.includes("%");
  if (isDelta) return null; // a delta line ("+35,1%"), not the value itself
  const compact = /^rp?\s*([\d.,]+)\s*(k|rb|jt|m)?$/i.exec(s.replace(/^rp/i, "Rp"));
  const bare = /^([\d.,]+)\s*(k|rb|jt|m)?$/i.exec(s);
  const m = compact || bare;
  if (!m) return null;
  // Indonesian grouping uses "." as thousands and "," as decimal — but a
  // short suffixed number like "3,7k" uses "," as the decimal point for
  // the compact form. Disambiguate by whether a decimal suffix is present.
  let numStr = m[1];
  const suffix = (m[2] || "").toLowerCase();
  if (suffix) {
    numStr = numStr.replace(/\./g, "").replace(",", ".");
  } else {
    numStr = numStr.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(numStr);
  if (!Number.isFinite(n)) return null;
  const mult = suffix === "k" || suffix === "rb" ? 1_000 : suffix === "jt" ? 1_000_000 : suffix === "m" ? 1_000_000_000 : 1;
  return n * mult;
}

export async function runAdsPhotoOcr(file: File, onProgress?: (pct: number) => void): Promise<OcrRow[]> {
  // The top-level Tesseract.recognize() convenience function doesn't expose
  // the output-format flags, and word-level bounding boxes ("blocks") are
  // OFF by default (text-only) — so this needs the lower-level worker API
  // with blocks explicitly requested.
  const worker = await Tesseract.createWorker("ind+eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") onProgress?.(Math.round(m.progress * 100));
    },
  });
  let page: Tesseract.Page;
  try {
    const { data } = await worker.recognize(file, {}, { blocks: true });
    page = data;
  } finally {
    await worker.terminate();
  }

  // Flatten blocks -> paragraphs -> lines -> words into one flat list.
  const words: Word[] = (page.blocks ?? [])
    .flatMap((b) => b.paragraphs)
    .flatMap((p) => p.lines)
    .flatMap((l) => l.words)
    .map((w) => ({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }))
    .filter((w) => w.text.trim());

  if (!words.length) return [];

  // ── 1. locate header columns ──────────────────────────────────────────
  type MetricKey = keyof Omit<OcrRow, "product_name">;
  const colAnchors: { key: MetricKey; x: number; headerY1: number }[] = [];
  for (const col of COLUMNS) {
    // A header label often spans 2+ words ("Iklan" + "Dilihat"); scan
    // consecutive word pairs/triples on the same line for a match.
    let best: { x: number; y1: number } | null = null;
    for (let i = 0; i < words.length; i++) {
      for (let span = 1; span <= 3 && i + span <= words.length; span++) {
        const group = words.slice(i, i + span);
        const sameLine = group.every((w) => Math.abs(w.y0 - group[0].y0) < 12);
        if (!sameLine) continue;
        const text = norm(group.map((w) => w.text).join(" "));
        if (col.labels.some((l) => text.includes(l))) {
          const x = (group[0].x0 + group[group.length - 1].x1) / 2;
          const y1 = Math.max(...group.map((w) => w.y1));
          if (!best || group[0].y0 < best.y1) best = { x, y1 };
        }
      }
    }
    if (best) colAnchors.push({ key: col.key, x: best.x, headerY1: best.y1 });
  }
  if (colAnchors.length < 3) return []; // couldn't find the table — let the caller show "no rows detected"

  colAnchors.sort((a, b) => a.x - b.x);
  const headerBottom = Math.max(...colAnchors.map((c) => c.headerY1));
  const firstColX = colAnchors[0].x;

  // ── 2. cluster body words into rows by y-proximity ─────────────────────
  const bodyWords = words.filter((w) => w.y0 > headerBottom + 4).sort((a, b) => a.y0 - b.y0);
  const rowBands: Word[][] = [];
  const ROW_GAP = 26; // px of vertical gap that starts a new row band
  for (const w of bodyWords) {
    const last = rowBands[rowBands.length - 1];
    if (last && w.y0 - Math.min(...last.map((x) => x.y0)) < ROW_GAP) last.push(w);
    else rowBands.push([w]);
  }

  // ── 3+4. build a row per band ────────────────────────────────────────
  const rows: OcrRow[] = [];
  for (const band of rowBands) {
    const nameWords = band.filter((w) => w.x0 < firstColX - 20);
    const productName = nameWords.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0)).map((w) => w.text).join(" ").trim();
    if (!productName) continue;

    const row: OcrRow = { product_name: productName, views: null, clicks: null, ad_cost: null, sales: null, conversion: null, items_sold: null };
    for (const anchor of colAnchors) {
      const cellWords = band
        .filter((w) => w.x0 >= firstColX - 20)
        .filter((w) => {
          const nearest = colAnchors.reduce((a, b) => (Math.abs(w.x0 + (w.x1 - w.x0) / 2 - b.x) < Math.abs(w.x0 + (w.x1 - w.x0) / 2 - a.x) ? b : a));
          return nearest.key === anchor.key;
        })
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      for (const w of cellWords) {
        const n = parseNumericToken(w.text);
        if (n != null) { row[anchor.key] = n; break; }
      }
    }
    rows.push(row);
  }
  return rows;
}
