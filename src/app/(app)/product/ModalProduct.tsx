"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { toNum } from "@/lib/parse";
import Loader from "@/components/Loader";

type AvgRow = {
  kode_produk: string; kode_variasi: string;
  nama_produk: string | null; nama_variasi: string | null;
  total_sales: number; total_units: number; avg_price: number | null;
};
type CostRow = { kode_produk: string; kode_variasi: string; harga_modal: number | null };
type Link = { owner: string | null; store_name: string | null };

const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

// Rupiah thousand-separator formatting — same pattern as the Ads Formulation
// threshold input: raw digits stored underneath, comma-grouped for display.
function formatRpInput(digits: string): string {
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}
function stripToDigits(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

export default function ModalProduct({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<AvgRow[] | null>(null);
  const [costs, setCosts] = useState<Map<string, string>>(new Map()); // key -> raw digits
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [sel, setSel] = useState({ owner: "", store: "" });
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const key = (k: string, v: string) => `${k}::${v}`;

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: sl } = await supabase.from("store_links").select("owner,store_name").eq("client_id", clientId);
      setLinks((sl as Link[]) || []);
    })();
  }, [supabase, clientId]);

  const owners = useMemo(() => Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort(), [links]);
  const storesForOwner = useMemo(() => sel.owner
    ? Array.from(new Set(links.filter((l) => l.owner === sel.owner).map((l) => l.store_name).filter(Boolean) as string[]))
    : Array.from(new Set(links.map((l) => l.store_name).filter(Boolean) as string[])), [links, sel.owner]);

  const load = useCallback(async () => {
    if (!clientId) return;
    const [{ data: avg }, { data: cc }] = await Promise.all([
      supabase.rpc("product_avg_price", { p_owner: sel.owner || null, p_store: sel.store || null }),
      supabase.from("product_costs").select("kode_produk,kode_variasi,harga_modal").eq("client_id", clientId),
    ]);
    setRows((avg as AvgRow[]) || []);
    const m = new Map<string, string>();
    for (const c of (cc as CostRow[]) || []) {
      if (c.harga_modal != null) m.set(key(c.kode_produk, c.kode_variasi), String(Math.round(c.harga_modal)));
    }
    setCosts(m);
  }, [supabase, clientId, sel]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.kode_produk || "").toLowerCase().includes(q) ||
      (r.nama_produk || "").toLowerCase().includes(q) ||
      (r.nama_variasi || "").toLowerCase().includes(q));
  }, [rows, search]);

  async function saveCost(r: AvgRow, digits: string) {
    const k = key(r.kode_produk, r.kode_variasi);
    setSaving(k);
    const harga_modal = digits.trim() === "" ? null : Number(digits);
    const { error } = await supabase.from("product_costs").upsert({
      client_id: clientId,
      kode_produk: r.kode_produk,
      kode_variasi: r.kode_variasi,
      nama_produk: r.nama_produk,
      nama_variasi: r.nama_variasi,
      harga_modal,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,kode_produk,kode_variasi" });
    setSaving(null);
    if (!error) setCosts((m) => new Map(m).set(k, digits));
  }

  // Export scoped strictly to the picked Store — the client fills in one
  // store's price list at a time, not a mixed multi-store dump.
  function exportExcel() {
    if (!rows || !sel.store) return;
    const data = rows.map((r) => {
      const digits = costs.get(key(r.kode_produk, r.kode_variasi));
      return {
        "Kode Product": r.kode_produk,
        "Nama Product": r.nama_produk || "",
        "Kode Variasi": r.kode_variasi,
        "Nama Variasi": r.nama_variasi || "",
        "AVG Harga Jual": r.avg_price != null ? Math.round(r.avg_price) : "",
        "Harga Modal Product": digits ? Number(digits) : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 16 }, { wch: 46 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modal Product");
    XLSX.writeFile(wb, `modal-product-${sel.store}.xlsx`);
  }

  async function importExcel(file: File) {
    setImporting(true);
    setImportMsg("");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const updates = json
      .map((row) => ({
        kode_produk: String(row["Kode Product"] ?? "").trim(),
        kode_variasi: String(row["Kode Variasi"] ?? "").trim() || "-",
        nama_produk: String(row["Nama Product"] ?? "").trim() || null,
        nama_variasi: String(row["Nama Variasi"] ?? "").trim() || null,
        harga_modal: toNum(row["Harga Modal Product"]),
      }))
      .filter((u) => u.kode_produk && u.harga_modal != null);

    if (!updates.length) {
      setImporting(false);
      setImportMsg("Tidak ada baris dengan Harga Modal Product yang valid.");
      return;
    }
    const { error } = await supabase.from("product_costs").upsert(
      updates.map((u) => ({ client_id: clientId, ...u, updated_at: new Date().toISOString() })),
      { onConflict: "client_id,kode_produk,kode_variasi" }
    );
    setImporting(false);
    if (error) { setImportMsg("✗ " + error.message); return; }
    setImportMsg(`✓ ${updates.length} harga modal diperbarui`);
    load();
  }

  if (rows === null) return <Loader center />;

  return (
    <div className="panel">
      <h3>Modal Product</h3>
      <div className="hint">Harga modal (cost) per produk/variasi — masukkan manual, tersimpan lintas upload. AVG Harga Jual dihitung dari seluruh histori SPOS (Penjualan Siap Dikirim ÷ Produk Siap Dikirim).</div>
      <div className="filterbar" style={{ marginTop: 10 }}>
        <Sel label="Owner" value={sel.owner} onChange={(v) => setSel({ owner: v, store: "" })} opts={owners} all="All Owners" />
        <Sel label="Store" value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesForOwner} all="All Stores" />
        <div className="fld" style={{ minWidth: 260 }}>
          <label>Cari</label>
          <input type="text" placeholder="Kode Produk / Nama Produk / Nama Variasi"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
        </div>
        <div className="fld" style={{ justifyContent: "flex-end" }}>
          <label>&nbsp;</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" disabled={!sel.store} onClick={exportExcel}
              title={sel.store ? "" : "Pilih Store terlebih dahulu"}
              style={{ opacity: sel.store ? 1 : 0.5, cursor: sel.store ? "pointer" : "not-allowed" }}>
              ⬇ Export Excel
            </button>
            <button className="btn-ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
              {importing ? "Mengimpor…" : "⬆ Import Excel"}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importExcel(f); e.target.value = ""; }} />
          </div>
        </div>
      </div>
      {!sel.store && <div className="hint" style={{ marginTop: 6 }}>Pilih Store untuk mengaktifkan Export (Import berlaku untuk semua produk, tanpa perlu Store).</div>}
      {importMsg && <div className="hint" style={{ marginTop: 6, color: importMsg.startsWith("✗") ? "#f87171" : "#86efac" }}>{importMsg}</div>}
      <div className="tbl-wrap" style={{ maxHeight: 440 }}>
        <table className="tbl">
          <thead><tr>
            <th>Kode Product</th><th>Nama Product</th><th>Kode Variasi</th><th>Nama Variasi</th>
            <th className="num">AVG Harga Jual</th><th className="num">Harga Modal Product</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => {
              const k = key(r.kode_produk, r.kode_variasi);
              const digits = costs.get(k) ?? "";
              return (
                <tr key={k}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.kode_produk}</td>
                  <td>{r.nama_produk || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.kode_variasi}</td>
                  <td>{r.nama_variasi || "—"}</td>
                  <td className="num">{r.avg_price != null ? rpFull(r.avg_price) : "—"}</td>
                  <td className="num">
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <span style={fInputWrap}>
                        <span style={{ color: "var(--muted)" }}>Rp</span>
                        <input type="text" inputMode="numeric" value={formatRpInput(digits)}
                          onChange={(e) => setCosts((m) => new Map(m).set(k, stripToDigits(e.target.value)))}
                          onBlur={(e) => saveCost(r, stripToDigits(e.target.value))}
                          placeholder="0"
                          style={{ border: "none", background: "transparent", color: "inherit", fontSize: "inherit", textAlign: "right", width: "100%", padding: 0, outline: "none" }} />
                      </span>
                      {saving === k && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>saving…</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No products found</td></tr>
            )}
          </tbody>
        </table>
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

const fInputWrap: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4, padding: "6px 9px",
  border: "1px solid rgba(201,162,39,.25)", borderRadius: 8, background: "rgba(10,22,40,.5)", minWidth: 130,
};
