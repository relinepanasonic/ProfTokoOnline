"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

const PAGE_SIZE = 100;

type MarketFee = {
  id: number;
  category: string; sub_category: string; jenis_product: string; platform: string; jenis_toko: string;
  platform_fee: number | null; biaya_proses_pesanan: number | null; biaya_layanan_mall: number | null;
  kategori_kirim: string | null;
  min_go_biasa: number | null; max_go_biasa: number | null;
  min_go_khusus: number | null; max_go_khusus: number | null;
  min_promo_xtra: number | null; max_promo_xtra: number | null;
  spaylater_3mo: number | null; spaylater_6mo: number | null;
  updated_month: string | null;
};
type Filters = { platforms: string[]; jenis_toko: string[] };

// Every numeric column from the CSV, in the same order as the source file
// — read-only here; the only way to change a value is re-uploading the
// CSV via the Upload tab (which logs Month + who for anything that changed).
const FEE_FIELDS: { key: keyof MarketFee; label: string; type: "percent" | "rupiah" }[] = [
  { key: "platform_fee",         label: "Platform Fee",                type: "percent" },
  { key: "biaya_proses_pesanan", label: "Biaya Proses Pesanan",        type: "rupiah" },
  { key: "biaya_layanan_mall",   label: "Biaya Layanan Mall",          type: "percent" },
  { key: "min_go_biasa",         label: "Min Gratis Ongkir Uk Biasa",  type: "percent" },
  { key: "max_go_biasa",         label: "Max Gratis Ongkir Uk Biasa",  type: "rupiah" },
  { key: "min_go_khusus",        label: "Min Gratis Ongkir Uk Khusus", type: "percent" },
  { key: "max_go_khusus",        label: "Max Gratis Ongkir Uk Khusus", type: "rupiah" },
  { key: "min_promo_xtra",       label: "Min Promo Xtra | XBP",        type: "percent" },
  { key: "max_promo_xtra",       label: "Max Promo Xtra | XBP",        type: "rupiah" },
  { key: "spaylater_3mo",        label: "Spaylater Xtra 3 bln",        type: "percent" },
  { key: "spaylater_6mo",        label: "Spaylater Xtra 6 bln",        type: "percent" },
];

function fmtFee(v: number | null, type: "percent" | "rupiah"): string {
  if (v == null) return "—";
  return type === "percent" ? `${v}%` : "Rp" + Math.round(v).toLocaleString("id-ID");
}

export default function MarketFeeTable({ clientId, refreshKey }: { clientId: string; onEdited: () => void; refreshKey: number }) {
  const [supabase] = useState(() => createClient());
  const [filters, setFilters] = useState<Filters>({ platforms: [], jenis_toko: [] });
  const [sel, setSel] = useState({ search: "", platform: "", toko: "" });

  const [rows, setRows] = useState<MarketFee[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: f } = await supabase.rpc("market_fee_filters");
      setFilters((f as Filters) || { platforms: [], jenis_toko: [] });
    })();
  }, [supabase, clientId]);

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    const { data } = await supabase.rpc("market_fee_search", {
      p_query: sel.search || null,
      p_platform: sel.platform || null,
      p_toko: sel.toko || null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    const result = data as { total: number; rows: MarketFee[] } | null;
    setTotal(result?.total || 0);
    setRows((prev) => (append && prev ? [...prev, ...(result?.rows || [])] : result?.rows || []));
    setLoading(false);
  }, [supabase, sel]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(0, false); }, [load, refreshKey]);

  if (rows === null) return <Loader center />;

  return (
    <div className="panel">
      <h3>Market Place Fee</h3>
      <div className="hint">Biaya platform Shopee &amp; Tiktok Tokped per kategori produk — nilai terkunci (read-only). Untuk memperbarui, upload ulang file di tab &quot;Upload Market Fee&quot;.</div>

      <div className="filterbar" style={{ marginTop: 10 }}>
        <div className="fld" style={{ minWidth: 240 }}>
          <label>Cari</label>
          <input type="text" placeholder="Category / Sub Category / Jenis Product"
            value={sel.search} onChange={(e) => setSel((s) => ({ ...s, search: e.target.value }))}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
        <Sel label="Platform" value={sel.platform} onChange={(v) => setSel((s) => ({ ...s, platform: v }))} opts={filters.platforms} all="All Platforms" />
        <Sel label="Jenis Toko" value={sel.toko} onChange={(v) => setSel((s) => ({ ...s, toko: v }))} opts={filters.jenis_toko} all="All Jenis Toko" />
        {loading && <Loader />}
      </div>

      <div style={{ fontSize: 11, color: "var(--gold)", margin: "4px 0 6px", opacity: 0.8 }}>← geser tabel untuk melihat semua kolom →</div>
      <div className="tbl-wrap scroll-x" style={{ maxHeight: "min(600px, 62vh)", overflow: "auto" }}>
        <table className="tbl" style={{ fontSize: 12.5, width: "max-content", minWidth: "100%" }}>
          <thead><tr>
            <th>Category</th><th>Sub Category</th><th>Jenis Product</th><th>Platform</th><th>Jenis Toko</th>
            <th>Kategori Kirim</th>
            {FEE_FIELDS.map((f) => <th key={f.key} className="num" style={{ whiteSpace: "nowrap" }}>{f.label}</th>)}
            <th style={{ whiteSpace: "nowrap" }}>Terakhir Diubah</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.category}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.sub_category}</td>
                <td style={{ maxWidth: 240, whiteSpace: "normal" }}>{r.jenis_product}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.platform}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.jenis_toko}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.kategori_kirim || "—"}</td>
                {FEE_FIELDS.map((f) => (
                  <td key={f.key} className="num" style={{ whiteSpace: "nowrap" }}>{fmtFee(r[f.key] as number | null, f.type)}</td>
                ))}
                <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--muted)" }}>{r.updated_month || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={FEE_FIELDS.length + 7} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No products found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 14 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{rows.length} / {total}</span>
        {rows.length < total && (
          <button className="btn-ghost" disabled={loading} onClick={() => load(rows.length, true)}>
            {loading ? "Memuat…" : "Load More"}
          </button>
        )}
      </div>
    </div>
  );
}

function Sel({ label, value, onChange, opts, all }: { label: string; value: string; onChange: (v: string) => void; opts: string[]; all: string }) {
  return (
    <div className="fld"><label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
