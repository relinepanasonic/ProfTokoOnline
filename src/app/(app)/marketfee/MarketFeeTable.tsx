"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
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

// Every editable numeric column from the CSV, in the same order as the
// source file — all shown inline now, nothing hidden behind an expand.
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

export default function MarketFeeTable({ clientId, onEdited, refreshKey }: { clientId: string; onEdited: () => void; refreshKey: number }) {
  const [supabase] = useState(() => createClient());
  const [filters, setFilters] = useState<Filters>({ platforms: [], jenis_toko: [] });
  const [sel, setSel] = useState({ search: "", platform: "", toko: "" });
  const now = new Date();
  const [month, setMonth] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const monthLabel = `${month} ${year}`;

  const [rows, setRows] = useState<MarketFee[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: f } = await supabase.rpc("market_fee_filters");
      setFilters((f as Filters) || { platforms: [], jenis_toko: [] });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        setCanEdit(p?.role === "superadmin" || p?.role === "client_admin");
      }
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

  async function saveField(row: MarketFee, field: string, value: number | null) {
    const { data, error } = await supabase.rpc("update_market_fee_field", {
      p_id: row.id, p_field: field, p_value: value, p_month: monthLabel,
    });
    if (!error && data) {
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...(data as MarketFee) } : r)) || null);
      onEdited();
    }
  }

  if (rows === null) return <Loader center />;

  return (
    <div className="panel">
      <h3>Market Place Fee</h3>
      <div className="hint">Biaya platform Shopee &amp; Tiktok Tokped per kategori produk — angka diedit langsung di sini, tidak lagi lewat Google Sheet. Perubahan dicatat di tab &quot;Edit Log&quot; (bulan + siapa yang mengubah).</div>

      <div className="filterbar" style={{ marginTop: 10 }}>
        <div className="fld" style={{ minWidth: 240 }}>
          <label>Cari</label>
          <input type="text" placeholder="Category / Sub Category / Jenis Product"
            value={sel.search} onChange={(e) => setSel((s) => ({ ...s, search: e.target.value }))}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
        <Sel label="Platform" value={sel.platform} onChange={(v) => setSel((s) => ({ ...s, platform: v }))} opts={filters.platforms} all="All Platforms" />
        <Sel label="Jenis Toko" value={sel.toko} onChange={(v) => setSel((s) => ({ ...s, toko: v }))} opts={filters.jenis_toko} all="All Jenis Toko" />
        {canEdit && (
          <div className="fld">
            <label>Update Month (untuk edit)</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTHS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 80 }} />
            </div>
          </div>
        )}
        {loading && <Loader />}
      </div>

      <div className="tbl-wrap" style={{ maxHeight: 640 }}>
        <table className="tbl" style={{ fontSize: 12.5 }}>
          <thead><tr>
            <th>Category</th><th>Sub Category</th><th>Jenis Product</th><th>Platform</th><th>Jenis Toko</th>
            <th>Kategori Kirim</th>
            {FEE_FIELDS.map((f) => <th key={f.key} className="num" style={{ whiteSpace: "nowrap" }}>{f.label}</th>)}
            <th style={{ whiteSpace: "nowrap" }}>Terakhir Diubah</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <FeeRow key={r.id} row={r} canEdit={canEdit} onSave={saveField} />
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

function FeeRow({ row, canEdit, onSave }: {
  row: MarketFee; canEdit: boolean;
  onSave: (row: MarketFee, field: string, value: number | null) => void;
}) {
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}>{row.category}</td>
      <td style={{ whiteSpace: "nowrap" }}>{row.sub_category}</td>
      <td style={{ maxWidth: 240, whiteSpace: "normal" }}>{row.jenis_product}</td>
      <td style={{ whiteSpace: "nowrap" }}>{row.platform}</td>
      <td style={{ whiteSpace: "nowrap" }}>{row.jenis_toko}</td>
      <td style={{ whiteSpace: "nowrap" }}>{row.kategori_kirim || "—"}</td>
      {FEE_FIELDS.map((f) => (
        <td key={f.key} className="num">
          <EditableCell value={row[f.key] as number | null} type={f.type} canEdit={canEdit} onSave={(v) => onSave(row, f.key, v)} />
        </td>
      ))}
      <td style={{ whiteSpace: "nowrap", fontSize: 11.5, color: "var(--muted)" }}>{row.updated_month || "—"}</td>
    </tr>
  );
}

function EditableCell({ value, type, canEdit, onSave }: {
  value: number | null; type: "percent" | "rupiah"; canEdit: boolean; onSave: (v: number | null) => void;
}) {
  return type === "percent"
    ? <PercentInput value={value} canEdit={canEdit} onSave={onSave} />
    : <RupiahInput value={value} canEdit={canEdit} onSave={onSave} />;
}

function PercentInput({ value, canEdit, onSave }: { value: number | null; canEdit: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  if (!canEdit) return <span>{value != null ? `${value}%` : "—"}</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
      <input type="number" step="0.01" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = v.trim() === "" ? null : Number(v); if (n !== value) onSave(n); }}
        style={{ width: 62, textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, color: "#e8edf8", fontSize: 12.5, padding: "3px 5px" }} />
      <span style={{ color: "var(--muted)", fontSize: 12 }}>%</span>
    </div>
  );
}
function RupiahInput({ value, canEdit, onSave }: { value: number | null; canEdit: boolean; onSave: (v: number | null) => void }) {
  const [digits, setDigits] = useState(value == null ? "" : String(Math.round(value)));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDigits(value == null ? "" : String(Math.round(value))); }, [value]);
  if (!canEdit) return <span>{value != null ? "Rp" + Math.round(value).toLocaleString("id-ID") : "—"}</span>;
  const formatted = digits ? Number(digits).toLocaleString("en-US") : "";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>Rp</span>
      <input type="text" inputMode="numeric" value={formatted}
        onChange={(e) => setDigits(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => { const n = digits === "" ? null : Number(digits); if (n !== value) onSave(n); }}
        style={{ width: 90, textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, color: "#e8edf8", fontSize: 12.5, padding: "3px 5px" }} />
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
