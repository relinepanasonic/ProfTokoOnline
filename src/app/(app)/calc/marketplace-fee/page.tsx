"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

const MONTH_LIST = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

type Fee = {
  id: string; category: string; sub_category: string | null; jenis_product: string | null;
  platform: string; jenis_toko: string | null;
  platform_fee_pct: number; biaya_proses_pesanan_rp: number; biaya_layanan_mall_pct: number;
  kategori_kirim: string | null;
  min_gratis_ongkir_biasa_pct: number; max_gratis_ongkir_biasa_rp: number;
  min_gratis_ongkir_khusus_pct: number; max_gratis_ongkir_khusus_rp: number;
  min_promo_xtra_pct: number; max_promo_xtra_rp: number;
  spaylater_xtra_3mo_pct: number; spaylater_xtra_6mo_pct: number;
  updated_by: string | null; updated_month: string | null;
};
type NumericField = Exclude<keyof Fee,
  "id" | "category" | "sub_category" | "jenis_product" | "platform" | "jenis_toko" | "kategori_kirim" | "updated_by" | "updated_month">;
type EditLog = { id: string; edited_by: string; edited_month: string } & Record<NumericField, number | null>;

// Column order here matches the source sheet's B–U span exactly (Category
// through Spay Later Xtra 6 mo) — every fee field visible inline, not
// hidden behind a modal.
const NUMERIC_FIELDS: { key: NumericField; label: string; unit: "%" | "Rp" }[] = [
  { key: "platform_fee_pct", label: "Platform Fee", unit: "%" },
  { key: "biaya_proses_pesanan_rp", label: "Biaya Proses Pesanan", unit: "Rp" },
  { key: "biaya_layanan_mall_pct", label: "Biaya Layanan Mall", unit: "%" },
  { key: "min_gratis_ongkir_biasa_pct", label: "Min Gratis Ongkir Uk Biasa", unit: "%" },
  { key: "max_gratis_ongkir_biasa_rp", label: "Max Gratis Ongkir Uk Biasa", unit: "Rp" },
  { key: "min_gratis_ongkir_khusus_pct", label: "Min Gratis Ongkir Uk Khusus", unit: "%" },
  { key: "max_gratis_ongkir_khusus_rp", label: "Max Gratis Ongkir Uk Khusus", unit: "Rp" },
  { key: "min_promo_xtra_pct", label: "Min Promo Xtra | XBP", unit: "%" },
  { key: "max_promo_xtra_rp", label: "Max Promo Xtra | XBP", unit: "Rp" },
  { key: "spaylater_xtra_3mo_pct", label: "Spay Later Xtra 3 mo", unit: "%" },
  { key: "spaylater_xtra_6mo_pct", label: "Spay Later Xtra 6 mo", unit: "%" },
];

function formatRp(n: number): string {
  return Math.round(n || 0).toLocaleString("id-ID");
}
function parseRp(s: string): number {
  return Number(s.replace(/[^\d-]/g, "")) || 0;
}
function currentMonthLabel(): string {
  const d = new Date();
  return `${MONTH_LIST[d.getMonth()]} ${d.getFullYear()}`;
}

async function fetchAllFees(supabase: ReturnType<typeof createClient>, clientId: string): Promise<Fee[]> {
  const PAGE = 1000;
  let from = 0;
  let all: Fee[] = [];
  for (;;) {
    const { data, error } = await supabase.from("market_fees").select("*").eq("client_id", clientId)
      .order("category").order("sub_category").range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    all = all.concat(data as Fee[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function MarketFeePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [myName, setMyName] = useState("");
  const [rows, setRows] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [historyFor, setHistoryFor] = useState<Fee | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setRows(await fetchAllFees(supabase, cid));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role, display_name, email, client_id").eq("id", user.id).single();
      const role = profile?.role;
      setCanEdit(role === "superadmin" || role === "client_admin");
      setMyName(profile?.display_name || profile?.email?.split("@")[0] || "Admin");
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = profile?.client_id || (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      reload(cid);
    })();
  }, [supabase, reload]);

  async function saveFee(fee: Fee, patch: Record<NumericField, number>) {
    const month = currentMonthLabel();
    const { error } = await supabase.from("market_fees").update({
      ...patch, updated_by: myName, updated_month: month,
    }).eq("id", fee.id);
    if (error) { alert(error.message); return; }
    const logEntry: Record<string, unknown> = { fee_id: fee.id, edited_by: myName, edited_month: month, ...patch };
    await supabase.from("market_fee_edits").insert(logEntry);
    reload(clientId);
  }

  async function addFee(row: Omit<Fee, "id" | "updated_by" | "updated_month">) {
    const { error } = await supabase.from("market_fees").insert({
      client_id: clientId,
      ...row,
      sub_category: row.sub_category?.trim() || null,
      jenis_product: row.jenis_product?.trim() || null,
      jenis_toko: row.jenis_toko?.trim() || null,
      kategori_kirim: row.kategori_kirim?.trim() || null,
    });
    if (error) { alert(error.message); return; }
    setShowAdd(false);
    reload(clientId);
  }

  async function delFee(id: string) {
    if (!confirm("Delete this fee entry?")) return;
    await supabase.from("market_fees").delete().eq("id", id);
    reload(clientId);
  }

  async function uploadCsv(file: File) {
    setUploading(true);
    setUploadMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/marketfee/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) { setUploadMsg(`✗ ${j.error}`); return; }
      setUploadMsg(`✓ Imported ${j.imported.toLocaleString("id-ID")} rows`);
      reload(clientId);
    } finally {
      setUploading(false);
    }
  }

  const platforms = useMemo(() => Array.from(new Set(rows.map((r) => r.platform).filter(Boolean))).sort(), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (platformFilter && r.platform !== platformFilter) return false;
      if (!q) return true;
      return [r.category, r.sub_category, r.jenis_product, r.platform, r.jenis_toko]
        .filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [rows, search, platformFilter]);

  // Same header names the CSV importer reads (HEADER_MAP in
  // /api/marketfee/import) so an exported file can be edited and
  // re-uploaded directly -- a round trip, not just a one-way dump.
  function exportCsv() {
    const headers = [
      "Category", "Sub Category", "Jenis Product", "Platform", "Jenis Toko",
      "Platform Fee", "Biaya Proses Pesanan", "Biaya Layanan Mall", "Kategori Kirim",
      "Min Gratis Ongkir Uk Biasa", "Max Gratis Ongkir Uk Biasa",
      "Min Gratis Ongkir Uk Khusus", "Max Gratis Ongkir Uk Khusus",
      "Min Promo Xtra", "Max Promo Xtra",
      "Spay Later Xtra 3 mo", "Spay Later Xtra 6 mo",
    ];
    const cell = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of filtered) {
      lines.push([
        r.category, r.sub_category, r.jenis_product, r.platform, r.jenis_toko,
        `${r.platform_fee_pct}%`, r.biaya_proses_pesanan_rp, `${r.biaya_layanan_mall_pct}%`, r.kategori_kirim,
        `${r.min_gratis_ongkir_biasa_pct}%`, r.max_gratis_ongkir_biasa_rp,
        `${r.min_gratis_ongkir_khusus_pct}%`, r.max_gratis_ongkir_khusus_rp,
        `${r.min_promo_xtra_pct}%`, r.max_promo_xtra_rp,
        `${r.spaylater_xtra_3mo_pct}%`, `${r.spaylater_xtra_6mo_pct}%`,
      ].map(cell).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = `market-place-fee_${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>
      {/* Sub-page tabs — Massive Calculator is /calc itself; this page is
          nested under it as /calc/marketplace-fee. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <Link href="/calc" className="mode-tab">Massive Calculator</Link>
        <span className="mode-tab on">Marketplace Fee</span>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
          <div>
            <h3 style={{ margin: 0 }}>Market Place Fee</h3>
            <div className="hint">
              {rows.length.toLocaleString("id-ID")} entries · every fee number below is editable{canEdit ? "" : " (admin only)"}.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn-ghost" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
            {canEdit && (
              <>
                <label className="btn-ghost" style={{ cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? .6 : 1 }}>
                  {uploading ? "Importing…" : "Upload CSV"}
                  <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCsv(f); e.target.value = ""; }} />
                </label>
                <button className="btn-gold" onClick={() => setShowAdd(true)}>+ Add Fee</button>
              </>
            )}
          </div>
        </div>
        {uploadMsg && (
          <div style={{ marginTop: 10, fontSize: 13, color: uploadMsg.startsWith("✓") ? "var(--gold)" : "#f87171" }}>{uploadMsg}</div>
        )}

        <div className="filterbar" style={{ marginTop: 14, marginBottom: 4 }}>
          <div className="fld" style={{ minWidth: 260 }}>
            <label>Search</label>
            <input type="text" placeholder="Category / Sub Category / Product / Jenis Toko"
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={inputStyle} />
          </div>
          <div className="fld">
            <label>Platform</label>
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="">All Platforms</option>
              {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="tbl-wrap" style={{ marginTop: 14, maxHeight: 640, overflowX: "auto", overflowY: "auto" }}>
          <table className="tbl" style={{ whiteSpace: "nowrap", width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={stickyTh}>Category</th><th style={stickyTh}>Sub Category</th><th style={stickyTh}>Jenis Product</th><th style={stickyTh}>Platform</th><th style={stickyTh}>Jenis Toko</th>
                {NUMERIC_FIELDS.map((f) => <th className="num" style={stickyTh} key={f.key}>{f.label}</th>)}
                <th style={stickyTh}>Kategori Kirim</th><th style={stickyTh}>Last Edited</th>{canEdit && <th style={stickyTh}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <FeeRow key={r.id} fee={r} canEdit={canEdit} onSave={saveFee} onDelete={delFee} onHistory={setHistoryFor} />
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={NUMERIC_FIELDS.length + 8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                  {rows.length ? "No fees match these filters" : "No fee entries yet"}
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={NUMERIC_FIELDS.length + 8} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {showAdd && <AddFeeModal onAdd={addFee} onClose={() => setShowAdd(false)} />}
        {historyFor && <HistoryModal fee={historyFor} supabase={supabase} onClose={() => setHistoryFor(null)} />}
      </div>
    </>
  );
}

function FeeRow({ fee, canEdit, onSave, onDelete, onHistory }: {
  fee: Fee; canEdit: boolean;
  onSave: (fee: Fee, patch: Record<NumericField, number>) => void;
  onDelete: (id: string) => void;
  onHistory: (fee: Fee) => void;
}) {
  const [values, setValues] = useState<Record<NumericField, string>>(() => {
    const v = {} as Record<NumericField, string>;
    for (const f of NUMERIC_FIELDS) v[f.key] = f.unit === "Rp" ? formatRp(fee[f.key]) : String(fee[f.key]);
    return v;
  });
  const numeric = useMemo(() => {
    const n = {} as Record<NumericField, number>;
    for (const f of NUMERIC_FIELDS) n[f.key] = f.unit === "Rp" ? parseRp(values[f.key]) : Number(values[f.key]) || 0;
    return n;
  }, [values]);
  const dirty = NUMERIC_FIELDS.some((f) => numeric[f.key] !== fee[f.key]);
  function save() {
    onSave(fee, numeric);
  }
  function reset() {
    const v = {} as Record<NumericField, string>;
    for (const f of NUMERIC_FIELDS) v[f.key] = f.unit === "Rp" ? formatRp(fee[f.key]) : String(fee[f.key]);
    setValues(v);
  }
  return (
    <tr style={dirty ? { background: "rgba(201,162,39,.06)" } : undefined}>
      <td style={{ fontWeight: 600 }}>{fee.category}</td>
      <td>{fee.sub_category || "—"}</td>
      <td style={{ maxWidth: 260, whiteSpace: "normal", fontSize: 12 }}>{fee.jenis_product || "—"}</td>
      <td>{fee.platform}</td>
      <td>{fee.jenis_toko || "—"}</td>
      {NUMERIC_FIELDS.map((f) => (
        <td className="num" key={f.key}>
          {canEdit ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {f.unit === "Rp" && <span style={{ color: "var(--muted)" }}>Rp</span>}
              {f.unit === "Rp" ? (
                <input type="text" inputMode="numeric" value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: formatRp(parseRp(e.target.value)) }))}
                  style={{ width: 86, textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 }} />
              ) : (
                <input type="text" inputMode="decimal" value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                  style={{ width: 60, textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 }} />
              )}
              {f.unit === "%" && <span style={{ color: "var(--muted)" }}>%</span>}
            </span>
          ) : (
            f.unit === "Rp" ? "Rp " + Math.round(fee[f.key] || 0).toLocaleString("id-ID") : `${fee[f.key]}%`
          )}
        </td>
      ))}
      <td>{fee.kategori_kirim || "—"}</td>
      <td style={{ fontSize: 11.5, color: "var(--muted)" }}>
        {fee.updated_by ? <button onClick={() => onHistory(fee)} style={linkBtnStyle}>{fee.updated_by} · {fee.updated_month}</button> : "—"}
      </td>
      {canEdit && (
        <td>
          <div style={{ display: "flex", gap: 6 }}>
            {dirty && <>
              <button onClick={save} style={saveBtnStyle}>Save</button>
              <button onClick={reset} className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>Cancel</button>
            </>}
            {!dirty && <button onClick={() => onDelete(fee.id)} style={delBtnStyle}>Delete</button>}
          </div>
        </td>
      )}
    </tr>
  );
}

function AddFeeModal({ onAdd, onClose }: {
  onAdd: (row: Omit<Fee, "id" | "updated_by" | "updated_month">) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    category: "", sub_category: "", jenis_product: "", platform: "Shopee", jenis_toko: "", kategori_kirim: "",
    platform_fee_pct: 0, biaya_proses_pesanan_rp: 0, biaya_layanan_mall_pct: 0,
    min_gratis_ongkir_biasa_pct: 0, max_gratis_ongkir_biasa_rp: 0,
    min_gratis_ongkir_khusus_pct: 0, max_gratis_ongkir_khusus_rp: 0,
    min_promo_xtra_pct: 0, max_promo_xtra_rp: 0,
    spaylater_xtra_3mo_pct: 0, spaylater_xtra_6mo_pct: 0,
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

function HistoryModal({ fee, supabase, onClose }: { fee: Fee; supabase: ReturnType<typeof createClient>; onClose: () => void }) {
  const [rows, setRows] = useState<EditLog[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("market_fee_edits").select("*").eq("fee_id", fee.id).order("created_at", { ascending: false });
      setRows((data as EditLog[]) || []);
    })();
  }, [fee.id, supabase]);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Edit History — {fee.category}{fee.sub_category ? ` · ${fee.sub_category}` : ""}</h3>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        {rows === null ? <div style={{ color: "var(--muted)" }}>Loading…</div> : (
          <div className="tbl-wrap" style={{ maxHeight: 400, overflowX: "auto", overflowY: "auto" }}>
            <table className="tbl" style={{ whiteSpace: "nowrap", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th>Month</th><th>Edited By</th>
                  {NUMERIC_FIELDS.map((f) => <th className="num" key={f.key}>{f.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.edited_month}</td>
                    <td>{r.edited_by}</td>
                    {NUMERIC_FIELDS.map((f) => (
                      <td className="num" key={f.key}>{f.unit === "Rp" ? "Rp " + Math.round(r[f.key] || 0).toLocaleString("id-ID") : `${r[f.key] ?? 0}%`}</td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={NUMERIC_FIELDS.length + 2} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No edits yet</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const stickyTh: React.CSSProperties = { position: "sticky", top: 0, zIndex: 1 };
const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%", boxSizing: "border-box" };
const linkBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 11.5, padding: 0, textDecoration: "underline dotted" };
const saveBtnStyle: React.CSSProperties = { background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", border: "none", color: "var(--navy-deep)", borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700 };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const dialog: React.CSSProperties = { width: "min(96vw,720px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
