"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  updated_by_name: string | null; updated_month: string | null;
};
type Filters = { platforms: string[]; jenis_toko: string[] };
type NumericField = Exclude<keyof MarketFee, "id" | "category" | "sub_category" | "jenis_product" | "platform" | "jenis_toko" | "kategori_kirim" | "updated_by_name" | "updated_month">;
type LogRow = {
  id: number; field_name: string; old_value: number | null; new_value: number | null;
  month: string; edited_by_name: string | null; created_at: string;
};

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// Same 11 fields the CSV importer diffs/logs (EDITABLE_FEE_FIELDS in
// src/lib/parseMarketFee.ts) — every one directly editable inline here too,
// not behind a modal. Order matches the source sheet's column order.
const NUMERIC_FIELDS: { key: NumericField; label: string; unit: "%" | "Rp" }[] = [
  { key: "platform_fee",         label: "Platform Fee",                unit: "%" },
  { key: "biaya_proses_pesanan", label: "Biaya Proses Pesanan",        unit: "Rp" },
  { key: "biaya_layanan_mall",   label: "Biaya Layanan Mall",          unit: "%" },
  { key: "min_go_biasa",         label: "Min Gratis Ongkir Uk Biasa",  unit: "%" },
  { key: "max_go_biasa",         label: "Max Gratis Ongkir Uk Biasa",  unit: "Rp" },
  { key: "min_go_khusus",        label: "Min Gratis Ongkir Uk Khusus", unit: "%" },
  { key: "max_go_khusus",        label: "Max Gratis Ongkir Uk Khusus", unit: "Rp" },
  { key: "min_promo_xtra",       label: "Min Promo Xtra | XBP",        unit: "%" },
  { key: "max_promo_xtra",       label: "Max Promo Xtra | XBP",        unit: "Rp" }, // Rp cap, not a percent
  { key: "spaylater_3mo",        label: "Spaylater Xtra 3 bln",        unit: "%" },
  { key: "spaylater_6mo",        label: "Spaylater Xtra 6 bln",        unit: "%" },
];
// Exact header text src/lib/parseMarketFee.ts's parseMarketFeeMatrix()
// looks for — export must use these verbatim so a downloaded CSV, edited
// in a spreadsheet, re-uploads with zero reformatting.
const EXPORT_HEADERS = [
  "Category", "Sub Category", "Jenis Product", "Platform", "Jenis Toko",
  "Platform Fee", "Biaya Proses Pesanan", "Biaya Layanan Mall", "Kategori Kirim",
  "Min Gratis Ongkir Uk Biasa", "Max Gratis Ongkir Uk Biasa",
  "Min Gratis Ongkir Uk Khusus", "Max Gratis Ongkir Uk Khusus",
  "Min Promo Xtra | XBP", "Max Promo Xtra | XBP",
  "Spay Later Xtra 3 mo", "Spay Later Xtra 6 mo",
];

function formatRp(n: number | null): string {
  return Math.round(n || 0).toLocaleString("id-ID");
}
function parseRp(s: string): number {
  return Number(s.replace(/[^\d-]/g, "")) || 0;
}
function currentMonthLabel(): string {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtFee(v: number | null, unit: "%" | "Rp"): string {
  if (v == null) return "—";
  return unit === "Rp" ? "Rp" + Math.round(v).toLocaleString("id-ID") : `${v}%`;
}

export default function MarketFeeTable({ clientId, refreshKey }: { clientId: string; onEdited: () => void; refreshKey: number }) {
  const [supabase] = useState(() => createClient());
  const [role, setRole] = useState("");
  const [myName, setMyName] = useState("");
  const [filters, setFilters] = useState<Filters>({ platforms: [], jenis_toko: [] });
  const [sel, setSel] = useState({ search: "", platform: "", toko: "" });

  const [rows, setRows] = useState<MarketFee[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [historyFor, setHistoryFor] = useState<MarketFee | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const canEdit = role === "superadmin" || role === "client_admin";

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role,display_name,username").eq("id", user.id).single();
      setRole(profile?.role || "");
      setMyName(profile?.display_name || profile?.username || "Admin");
    })();
  }, [supabase]);

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

  function reload() { load(0, false); }

  async function saveRow(fee: MarketFee, patch: Record<NumericField, number> & { kategori_kirim: string }) {
    const month = currentMonthLabel();
    const { error } = await supabase.rpc("save_market_fee_row", {
      p_id: fee.id,
      p_platform_fee: patch.platform_fee,
      p_biaya_proses_pesanan: patch.biaya_proses_pesanan,
      p_biaya_layanan_mall: patch.biaya_layanan_mall,
      p_kategori_kirim: patch.kategori_kirim || null,
      p_min_go_biasa: patch.min_go_biasa,
      p_max_go_biasa: patch.max_go_biasa,
      p_min_go_khusus: patch.min_go_khusus,
      p_max_go_khusus: patch.max_go_khusus,
      p_min_promo_xtra: patch.min_promo_xtra,
      p_max_promo_xtra: patch.max_promo_xtra,
      p_spaylater_3mo: patch.spaylater_3mo,
      p_spaylater_6mo: patch.spaylater_6mo,
      p_month: month,
    });
    if (error) { alert(error.message); return; }
    reload();
  }

  async function addFee(row: Omit<MarketFee, "id" | "updated_by_name" | "updated_month">) {
    const { error } = await supabase.from("market_fees").insert({
      client_id: clientId,
      ...row,
      sub_category: row.sub_category?.trim() || "",
      jenis_product: row.jenis_product?.trim() || "",
      jenis_toko: row.jenis_toko?.trim() || "",
      kategori_kirim: row.kategori_kirim?.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by_name: myName,
      updated_month: currentMonthLabel(),
    });
    if (error) { alert(error.message); return; }
    setShowAdd(false);
    reload();
  }

  async function delFee(id: number) {
    if (!confirm("Delete this fee entry? This cannot be undone.")) return;
    const { error } = await supabase.from("market_fees").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    reload();
  }

  // Pulls every row matching the current filters (not just the loaded
  // page) by walking market_fee_search — same RLS/filter behavior as the
  // table itself, just paged through fully instead of stopping at 100.
  async function exportCsv() {
    setExporting(true);
    try {
      let all: MarketFee[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data } = await supabase.rpc("market_fee_search", {
          p_query: sel.search || null, p_platform: sel.platform || null, p_toko: sel.toko || null,
          p_limit: PAGE_SIZE, p_offset: offset,
        });
        const result = data as { total: number; rows: MarketFee[] } | null;
        const batch = result?.rows || [];
        all = all.concat(batch);
        if (batch.length < PAGE_SIZE) break;
      }
      const cell = (v: string | number | null) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [EXPORT_HEADERS.join(",")];
      for (const r of all) {
        lines.push([
          r.category, r.sub_category, r.jenis_product, r.platform, r.jenis_toko,
          r.platform_fee ?? "", r.biaya_proses_pesanan ?? "", r.biaya_layanan_mall ?? "", r.kategori_kirim,
          r.min_go_biasa ?? "", r.max_go_biasa ?? "",
          r.min_go_khusus ?? "", r.max_go_khusus ?? "",
          r.min_promo_xtra ?? "", r.max_promo_xtra ?? "",
          r.spaylater_3mo ?? "", r.spaylater_6mo ?? "",
        ].map(cell).join(","));
      }
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `market-place-fee_${stamp}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (rows === null) return <Loader center />;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>Market Place Fee</h3>
          <div className="hint">
            Biaya platform Shopee &amp; Tiktok Tokped per kategori produk — {canEdit ? "setiap angka bisa diedit langsung di tabel." : "hubungi admin untuk mengubah nilai."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn-ghost" onClick={exportCsv} disabled={exporting || !total}>{exporting ? "Exporting…" : "Export CSV"}</button>
          {canEdit && <button className="btn-gold" onClick={() => setShowAdd(true)}>+ Add Fee</button>}
        </div>
      </div>

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
            {NUMERIC_FIELDS.map((f) => <th key={f.key} className="num" style={{ whiteSpace: "nowrap" }}>{f.label}</th>)}
            <th style={{ whiteSpace: "nowrap" }}>Terakhir Diubah</th>
            {canEdit && <th></th>}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <FeeRow key={r.id} fee={r} canEdit={canEdit} onSave={saveRow} onDelete={delFee} onHistory={setHistoryFor} />
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={NUMERIC_FIELDS.length + 7 + (canEdit ? 1 : 0)} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No products found</td></tr>
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

      {showAdd && <AddFeeModal onAdd={addFee} onClose={() => setShowAdd(false)} />}
      {historyFor && <HistoryModal fee={historyFor} supabase={supabase} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function FeeRow({ fee, canEdit, onSave, onDelete, onHistory }: {
  fee: MarketFee; canEdit: boolean;
  onSave: (fee: MarketFee, patch: Record<NumericField, number> & { kategori_kirim: string }) => void;
  onDelete: (id: number) => void;
  onHistory: (fee: MarketFee) => void;
}) {
  const initial = () => {
    const v = {} as Record<NumericField, string>;
    for (const f of NUMERIC_FIELDS) v[f.key] = f.unit === "Rp" ? formatRp(fee[f.key]) : String(fee[f.key] ?? 0);
    return v;
  };
  const [values, setValues] = useState<Record<NumericField, string>>(initial);
  const [kirim, setKirim] = useState(fee.kategori_kirim || "");

  const numeric = useMemo(() => {
    const n = {} as Record<NumericField, number>;
    for (const f of NUMERIC_FIELDS) n[f.key] = f.unit === "Rp" ? parseRp(values[f.key]) : Number(values[f.key]) || 0;
    return n;
  }, [values]);
  const dirty = NUMERIC_FIELDS.some((f) => numeric[f.key] !== (fee[f.key] ?? 0)) || kirim !== (fee.kategori_kirim || "");

  function save() { onSave(fee, { ...numeric, kategori_kirim: kirim }); }
  function reset() { setValues(initial()); setKirim(fee.kategori_kirim || ""); }

  return (
    <tr style={dirty ? { background: "rgba(201,162,39,.06)" } : undefined}>
      <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>{fee.category}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fee.sub_category}</td>
      <td style={{ maxWidth: 240, whiteSpace: "normal" }}>{fee.jenis_product}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fee.platform}</td>
      <td style={{ whiteSpace: "nowrap" }}>{fee.jenis_toko}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        {canEdit ? (
          <input type="text" value={kirim} onChange={(e) => setKirim(e.target.value)} placeholder="—" style={textCellStyle} />
        ) : (fee.kategori_kirim || "—")}
      </td>
      {NUMERIC_FIELDS.map((f) => (
        <td className="num" key={f.key} style={{ whiteSpace: "nowrap" }}>
          {canEdit ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {f.unit === "Rp" && <span style={{ color: "var(--muted)" }}>Rp</span>}
              {f.unit === "Rp" ? (
                <input type="text" inputMode="numeric" value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: formatRp(parseRp(e.target.value)) }))}
                  style={numCellStyle(86)} />
              ) : (
                <input type="text" inputMode="decimal" value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                  style={numCellStyle(58)} />
              )}
              {f.unit === "%" && <span style={{ color: "var(--muted)" }}>%</span>}
            </span>
          ) : fmtFee(fee[f.key], f.unit)}
        </td>
      ))}
      <td style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
        {fee.updated_month
          ? <button onClick={() => onHistory(fee)} style={linkBtnStyle}>{fee.updated_by_name ? `${fee.updated_by_name} · ` : ""}{fee.updated_month}</button>
          : "—"}
      </td>
      {canEdit && (
        <td style={{ whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {dirty ? (
              <>
                <button onClick={save} style={saveBtnStyle}>Save</button>
                <button onClick={reset} className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>Cancel</button>
              </>
            ) : (
              <button onClick={() => onDelete(fee.id)} style={delBtnStyle}>Delete</button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function AddFeeModal({ onAdd, onClose }: {
  onAdd: (row: Omit<MarketFee, "id" | "updated_by_name" | "updated_month">) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    category: "", sub_category: "", jenis_product: "", platform: "Shopee", jenis_toko: "", kategori_kirim: "",
    platform_fee: 0, biaya_proses_pesanan: 0, biaya_layanan_mall: 0,
    min_go_biasa: 0, max_go_biasa: 0, min_go_khusus: 0, max_go_khusus: 0,
    min_promo_xtra: 0, max_promo_xtra: 0, spaylater_3mo: 0, spaylater_6mo: 0,
  });
  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px" }}>Add Market Place Fee</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ModalField label="Category"><input style={inputStyle} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></ModalField>
          <ModalField label="Sub Category"><input style={inputStyle} value={f.sub_category} onChange={(e) => setF({ ...f, sub_category: e.target.value })} /></ModalField>
          <ModalField label="Jenis Product" full><input style={inputStyle} value={f.jenis_product} onChange={(e) => setF({ ...f, jenis_product: e.target.value })} /></ModalField>
          <ModalField label="Platform"><input style={inputStyle} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /></ModalField>
          <ModalField label="Jenis Toko"><input style={inputStyle} value={f.jenis_toko} onChange={(e) => setF({ ...f, jenis_toko: e.target.value })} /></ModalField>
          <ModalField label="Kategori Kirim"><input style={inputStyle} value={f.kategori_kirim} onChange={(e) => setF({ ...f, kategori_kirim: e.target.value })} /></ModalField>
          {NUMERIC_FIELDS.map((nf) => (
            <ModalField label={nf.label} key={nf.key}>
              {nf.unit === "Rp" ? (
                <input type="text" inputMode="numeric" style={inputStyle} value={formatRp(f[nf.key])}
                  onChange={(e) => setF({ ...f, [nf.key]: parseRp(e.target.value) })} />
              ) : (
                <input type="text" inputMode="decimal" style={inputStyle} value={f[nf.key]}
                  onChange={(e) => setF({ ...f, [nf.key]: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
              )}
            </ModalField>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-gold" disabled={!f.category || !f.platform} onClick={() => onAdd(f)}>Add</button>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, f.label]));
const RUPIAH_FIELDS = new Set(NUMERIC_FIELDS.filter((f) => f.unit === "Rp").map((f) => f.key));

// Groups the per-field log rows a single Save produces (save_market_fee_row
// inserts one row per changed field, all in the same statement) back into
// one "edit event" per row — same effect as a full-row snapshot log without
// needing one, since market_fee_log's old_value/new_value stay `numeric`.
// Grouped by (month, editor, minute) since several field rows from one save
// share the same edited_by/month and land within the same transaction.
function groupHistory(rows: LogRow[]): { key: string; month: string; editor: string; when: string; fields: LogRow[] }[] {
  const groups = new Map<string, { key: string; month: string; editor: string; when: string; fields: LogRow[] }>();
  for (const r of rows) {
    const minuteBucket = r.created_at.slice(0, 16); // YYYY-MM-DDTHH:MM
    const key = `${r.month}::${r.edited_by_name || ""}::${minuteBucket}`;
    if (!groups.has(key)) groups.set(key, { key, month: r.month, editor: r.edited_by_name || "—", when: r.created_at, fields: [] });
    groups.get(key)!.fields.push(r);
  }
  return Array.from(groups.values()).sort((a, b) => (a.when < b.when ? 1 : -1));
}

function HistoryModal({ fee, supabase, onClose }: { fee: MarketFee; supabase: ReturnType<typeof createClient>; onClose: () => void }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("market_fee_log")
        .select("id,field_name,old_value,new_value,month,edited_by_name,created_at")
        .eq("market_fee_id", fee.id).order("created_at", { ascending: false }).limit(500);
      setRows((data as LogRow[]) || []);
    })();
  }, [fee.id, supabase]);

  const groups = useMemo(() => (rows ? groupHistory(rows) : []), [rows]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Edit History — {fee.category} · {fee.sub_category}</h3>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        <div className="hint" style={{ marginBottom: 12 }}>
          Riwayat perubahan — dicatat per bulan dan siapa yang mengubah, bukan per tanggal.
        </div>
        {rows === null ? <div style={{ color: "var(--muted)" }}>Loading…</div> : (
          <div style={{ display: "grid", gap: 12, maxHeight: 480, overflowY: "auto" }}>
            {groups.map((g) => (
              <div key={g.key} style={{ border: "1px solid var(--card-border)", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: "var(--gold)" }}>{g.month}</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{g.editor}</span>
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {g.fields.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                      <span style={{ color: "var(--text-2)" }}>{FIELD_LABEL[r.field_name] || r.field_name}</span>
                      <span>
                        <span style={{ color: "var(--muted)" }}>{fmtFee(r.old_value, RUPIAH_FIELDS.has(r.field_name as NumericField) ? "Rp" : "%")}</span>
                        {" → "}
                        <span style={{ color: "var(--gold)", fontWeight: 700 }}>{fmtFee(r.new_value, RUPIAH_FIELDS.has(r.field_name as NumericField) ? "Rp" : "%")}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {groups.length === 0 && <div style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No edits yet</div>}
          </div>
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

const textCellStyle: React.CSSProperties = { width: 110, background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 };
const numCellStyle = (w: number): React.CSSProperties => ({ width: w, textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 });
const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%", boxSizing: "border-box" };
const linkBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11.5, padding: 0, textDecoration: "underline dotted" };
const saveBtnStyle: React.CSSProperties = { background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", border: "none", color: "var(--navy-deep)", borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const dialog: React.CSSProperties = { width: "min(96vw,720px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
