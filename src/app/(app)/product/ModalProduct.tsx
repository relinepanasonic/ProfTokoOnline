"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

type CatalogRow = {
  kode_produk: string; kode_variasi: string;
  nama_produk: string | null; nama_variasi: string | null;
  has_variant: boolean; last_price: number | null;
  pic_client: string | null; store_name: string | null;
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
// A '-' placeholder row for a product that HAS variants is shown for
// context but can't take its own cost — only its variant rows can.
function isLocked(r: CatalogRow): boolean {
  return r.kode_variasi === "-" && r.has_variant;
}

export default function ModalProduct({ clientId }: { clientId: string }) {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<CatalogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [costs, setCosts] = useState<Map<string, string>>(new Map()); // key -> raw digits (pre-filled from the last save)
  const [dirty, setDirty] = useState<Set<string>>(new Set()); // keys edited since the last Save click
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [search, setSearch] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [sel, setSel] = useState({ owner: "", store: "" });

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

  // Same gate as Finance Detail / Ops Performance: nothing loads (and no
  // product names leak into the table) until a Store is actually picked.
  const load = useCallback(async () => {
    if (!clientId || !sel.store) { setRows(null); return; }
    setLoading(true);
    const q = supabase.from("product_catalog")
      .select("kode_produk,kode_variasi,nama_produk,nama_variasi,has_variant,last_price,pic_client,store_name")
      .eq("client_id", clientId)
      .eq("store_name", sel.store)
      .order("nama_produk").order("kode_produk").order("has_variant", { ascending: false }).order("kode_variasi");
    const [{ data: cat }, { data: cc }] = await Promise.all([
      q,
      supabase.from("product_costs").select("kode_produk,kode_variasi,harga_modal").eq("client_id", clientId),
    ]);
    setRows((cat as CatalogRow[]) || []);
    const m = new Map<string, string>();
    for (const c of (cc as CostRow[]) || []) {
      if (c.harga_modal != null) m.set(key(c.kode_produk, c.kode_variasi), String(Math.round(c.harga_modal)));
    }
    setCosts(m);
    setLoading(false);
  }, [supabase, clientId, sel.store]);

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

  function editCost(k: string, digits: string) {
    setCosts((m) => new Map(m).set(k, digits));
    setDirty((d) => new Set(d).add(k));
  }

  // Batch save — the user fills in as many rows as they want, then clicks
  // Save once, instead of every field firing its own request on blur.
  async function saveAll() {
    if (!rows || dirty.size === 0) return;
    setSaving(true);
    setSaveMsg("");
    const byKey = new Map(rows.map((r) => [key(r.kode_produk, r.kode_variasi), r]));
    const updates = Array.from(dirty)
      .map((k) => byKey.get(k))
      .filter((r): r is CatalogRow => !!r && !isLocked(r))
      .map((r) => ({
        client_id: clientId,
        kode_produk: r.kode_produk,
        kode_variasi: r.kode_variasi,
        nama_produk: r.nama_produk,
        nama_variasi: r.nama_variasi,
        harga_modal: (() => { const d = costs.get(key(r.kode_produk, r.kode_variasi)) ?? ""; return d.trim() === "" ? null : Number(d); })(),
        updated_at: new Date().toISOString(),
      }));
    const { error } = await supabase.from("product_costs").upsert(updates, { onConflict: "client_id,kode_produk,kode_variasi" });
    setSaving(false);
    if (error) { setSaveMsg("✗ " + error.message); return; }
    setDirty(new Set());
    setSaveMsg(`✓ ${updates.length} harga modal disimpan`);
  }

  return (
    <div className="panel">
      <h3>Modal Product</h3>
      <div className="hint">Harga modal (cost) per produk/variasi — masukkan manual, tersimpan lintas upload. Produk dengan variasi hanya bisa diisi di baris variasinya (baris produk terkunci). Harga Jual Terakhir memakai bulan terbaru saja (Penjualan Siap Dikirim ÷ Produk Siap Dikirim), bukan rata-rata seluruh histori.</div>
      <div className="filterbar" style={{ marginTop: 10 }}>
        <Sel label="Owner" value={sel.owner} onChange={(v) => setSel({ owner: v, store: "" })} opts={owners} all="All Owners" />
        <Sel label="Store" value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesForOwner} all="Pick a store…" />
        {sel.store && (
          <div className="fld" style={{ minWidth: 260 }}>
            <label>Cari</label>
            <input type="text" placeholder="Kode Produk / Nama Produk / Nama Variasi"
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
          </div>
        )}
        {sel.store && (
          <div className="fld" style={{ justifyContent: "flex-end" }}>
            <label>&nbsp;</label>
            <button className="btn-gold" disabled={saving || dirty.size === 0} onClick={saveAll} style={{ padding: "8px 22px" }}>
              {saving ? "Menyimpan…" : dirty.size > 0 ? `Save (${dirty.size})` : "Save"}
            </button>
          </div>
        )}
        {loading && <Loader />}
      </div>
      {saveMsg && <div className="hint" style={{ marginTop: 6, color: saveMsg.startsWith("✗") ? "#f87171" : "#86efac" }}>{saveMsg}</div>}

      {!sel.store ? (
        <div className="coming">
          <div className="big">🏬</div>
          <h3 style={{ fontSize: 18, color: "#fff", margin: 0 }}>Pilih Toko</h3>
          <p style={{ maxWidth: 420, margin: 0 }}>Modal Product ditampilkan per store — pilih satu Store di atas untuk lanjut.</p>
        </div>
      ) : rows === null ? null : (
      <div className="tbl-wrap" style={{ maxHeight: 440 }}>
        <table className="tbl">
          <thead><tr>
            <th>Kode Product</th><th>Nama Product</th><th>Kode Variasi</th><th>Nama Variasi</th>
            <th className="num">Harga Jual Terakhir</th><th className="num">Harga Modal Product</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => {
              const k = key(r.kode_produk, r.kode_variasi);
              const digits = costs.get(k) ?? "";
              const isDirty = dirty.has(k);
              const locked = isLocked(r);
              return (
                <tr key={k} style={locked ? { background: "rgba(255,255,255,.03)" } : undefined}>
                  <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.kode_produk}</td>
                  <td>{r.nama_produk || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 12, color: locked ? "var(--muted)" : undefined }}>{locked ? "—" : r.kode_variasi}</td>
                  <td style={{ color: locked ? "var(--muted)" : undefined, fontStyle: locked ? "italic" : undefined }}>{locked ? "Ada variasi — isi di baris variasi" : (r.nama_variasi || "—")}</td>
                  <td className="num">{r.last_price != null ? rpFull(r.last_price) : "—"}</td>
                  <td className="num">
                    {locked ? (
                      <div style={{ display: "flex", justifyContent: "flex-end", color: "var(--muted)", fontSize: 12 }}>🔒 Terkunci</div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <span style={{ ...fInputWrap, borderColor: isDirty ? "var(--gold)" : "rgba(201,162,39,.25)" }}>
                          <span style={{ color: "var(--muted)" }}>Rp</span>
                          <input type="text" inputMode="numeric" value={formatRpInput(digits)}
                            onChange={(e) => editCost(k, stripToDigits(e.target.value))}
                            placeholder="0"
                            style={{ border: "none", background: "transparent", color: "inherit", fontSize: "inherit", textAlign: "right", width: "100%", padding: 0, outline: "none" }} />
                        </span>
                      </div>
                    )}
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
      )}
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
