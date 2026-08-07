"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Fee = {
  category: string; sub_category: string | null; jenis_product: string | null;
  platform: string; jenis_toko: string | null;
  platform_fee_pct: number; biaya_proses_pesanan_rp: number; biaya_layanan_mall_pct: number;
  min_gratis_ongkir_biasa_pct: number; max_gratis_ongkir_biasa_rp: number;
  min_gratis_ongkir_khusus_pct: number; max_gratis_ongkir_khusus_rp: number;
};
type Item = {
  id: string; item_name: string;
  category: string | null; sub_category: string | null; jenis_product: string | null;
  platform: string | null; jenis_toko: string | null;
  modal_produk_rp: number; harga_jual_rp: number;
  weight_kg: number; volume_cm3: number;
};

// Shipping-weight threshold that flips a product from the "biasa" to the
// "khusus" Gratis Ongkir tier (either condition triggers it, per the
// business rule as given — not derived from any dimension table).
const KHUSUS_WEIGHT_KG = 5;
const KHUSUS_VOLUME_CM3 = 20000;

function feeKey(x: { category: string | null; sub_category: string | null; jenis_product: string | null; platform: string | null; jenis_toko: string | null }): string {
  return [x.category || "", x.sub_category || "", x.jenis_product || "", x.platform || "", x.jenis_toko || ""].join("::");
}

// Total Biaya = Platform Fee % + Biaya Proses Pesanan (flat) + Biaya
// Layanan Mall % (0 for non-mall rows already, no extra branching needed)
// + Gratis Ongkir subsidy, capped: MIN(ongkir_pct% x Harga Jual, ongkir_max_rp).
// Ongkir tier (biasa vs khusus) is picked from the product's own
// weight/volume, not from the matched fee row.
function computeBiaya(item: Item, fee: Fee | null): { totalBiaya: number; profit: number; ongkirTier: "biasa" | "khusus" | null } {
  const hj = item.harga_jual_rp || 0;
  if (!fee) return { totalBiaya: 0, profit: hj - (item.modal_produk_rp || 0), ongkirTier: null };

  const isKhusus = (item.weight_kg || 0) > KHUSUS_WEIGHT_KG || (item.volume_cm3 || 0) > KHUSUS_VOLUME_CM3;
  const ongkirPct = isKhusus ? fee.min_gratis_ongkir_khusus_pct : fee.min_gratis_ongkir_biasa_pct;
  const ongkirMaxRp = isKhusus ? fee.max_gratis_ongkir_khusus_rp : fee.max_gratis_ongkir_biasa_rp;
  const ongkirCost = Math.min((ongkirPct / 100) * hj, ongkirMaxRp);

  const platformFee = (fee.platform_fee_pct / 100) * hj;
  const mallFee = (fee.biaya_layanan_mall_pct / 100) * hj;
  const totalBiaya = platformFee + fee.biaya_proses_pesanan_rp + mallFee + Math.max(ongkirCost, 0);
  return { totalBiaya, profit: hj - (item.modal_produk_rp || 0) - totalBiaya, ongkirTier: isKhusus ? "khusus" : "biasa" };
}

function formatRp(n: number): string { return Math.round(n || 0).toLocaleString("id-ID"); }
function parseRp(s: string): number { return Number(s.replace(/[^\d-]/g, "")) || 0; }

async function fetchAll<T>(supabase: ReturnType<typeof createClient>, table: string, clientId: string, select = "*"): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  let all: T[] = [];
  for (;;) {
    const { data, error } = await supabase.from(table).select(select).eq("client_id", clientId).range(from, from + PAGE - 1);
    if (error || !data || !data.length) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [fees, setFees] = useState<Fee[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const feeMap = useMemo(() => {
    const m = new Map<string, Fee>();
    for (const f of fees) m.set(feeKey(f), f);
    return m;
  }, [fees]);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const [feeRows, itemRows] = await Promise.all([
      fetchAll<Fee>(supabase, "market_fees", cid,
        "category,sub_category,jenis_product,platform,jenis_toko,platform_fee_pct,biaya_proses_pesanan_rp,biaya_layanan_mall_pct,min_gratis_ongkir_biasa_pct,max_gratis_ongkir_biasa_rp,min_gratis_ongkir_khusus_pct,max_gratis_ongkir_khusus_rp"),
      fetchAll<Item>(supabase, "price_calc_items", cid),
    ]);
    setFees(feeRows);
    setItems(itemRows);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role,client_id").eq("id", user.id).single();
      const role = profile?.role;
      setCanEdit(role === "superadmin" || role === "client_admin" || role === "branch_manager");
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = profile?.client_id || (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      reload(cid);
    })();
  }, [supabase, reload]);

  async function patchItem(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    const { error } = await supabase.from("price_calc_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) alert(error.message);
  }

  async function addItem(row: Omit<Item, "id">) {
    const { error } = await supabase.from("price_calc_items").insert({ client_id: clientId, ...row });
    if (error) { alert(error.message); return; }
    setShowAdd(false);
    reload(clientId);
  }

  async function delItem(id: string) {
    if (!confirm("Delete this product row?")) return;
    await supabase.from("price_calc_items").delete().eq("id", id);
    reload(clientId);
  }

  async function uploadCsv(file: File) {
    setUploading(true);
    setUploadMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pricecalc/import", {
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.item_name, it.category, it.platform, it.jenis_toko].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q))
    );
  }, [items, search]);

  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <span className="mode-tab on">Massive Calculator</span>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Massive Calculator</h3>
            <div className="hint">
              {items.length.toLocaleString("id-ID")} product rows · pick Category/Sub Category/Jenis Product/Platform/Jenis Toko to link a fee row, fill in price and weight, Total Biaya / Profit update live.
            </div>
          </div>
          {canEdit && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <label className="btn-ghost" style={{ cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? .6 : 1 }}>
                {uploading ? "Importing…" : "Upload Bulk"}
                <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCsv(f); e.target.value = ""; }} />
              </label>
              <button className="btn-gold" onClick={() => setShowAdd(true)}>+ Add Product</button>
            </div>
          )}
        </div>
        {uploadMsg && (
          <div style={{ marginTop: 10, fontSize: 13, color: uploadMsg.startsWith("✓") ? "var(--gold)" : "#f87171" }}>{uploadMsg}</div>
        )}

        <div className="filterbar" style={{ marginTop: 14, marginBottom: 4 }}>
          <div className="fld" style={{ minWidth: 260 }}>
            <label>Search</label>
            <input type="text" placeholder="Item Product / Category / Platform / Jenis Toko"
              value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div className="tbl-wrap scroll-x" style={{ marginTop: 14, maxHeight: "min(640px, 66vh)", overflow: "auto" }}>
          <table className="tbl" style={{ fontSize: 12.5, width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={stickyTh}>No</th>
                <th style={stickyTh}>Item Product</th>
                <th style={stickyTh}>Category</th>
                <th style={stickyTh}>Sub Category</th>
                <th style={stickyTh}>Jenis Product</th>
                <th style={stickyTh}>Platform</th>
                <th style={stickyTh}>Jenis Toko</th>
                <th className="num" style={stickyTh}>Berat (Kg)</th>
                <th className="num" style={stickyTh}>Volume (cm³)</th>
                <th className="num" style={stickyTh}>Modal Produk</th>
                <th className="num" style={stickyTh}>Harga Jual (Rp)</th>
                <th className="num" style={stickyTh}>Harga Jual (%)</th>
                <th className="num" style={stickyTh}>Total Biaya</th>
                <th className="num" style={stickyTh}>Profit</th>
                <th style={stickyTh}>Category (Fee)</th>
                {canEdit && <th style={stickyTh}></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <ItemRow key={item.id} no={i + 1} item={item} fees={fees} feeMap={feeMap} canEdit={canEdit}
                  onPatch={(patch) => patchItem(item.id, patch)} onDelete={() => delItem(item.id)} />
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={16} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                  {items.length ? "No products match this search" : "No products yet"}
                </td></tr>
              )}
              {loading && (
                <tr><td colSpan={16} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {showAdd && <AddProductModal fees={fees} onAdd={addItem} onClose={() => setShowAdd(false)} />}
      </div>
    </>
  );
}

// Cascading Category -> Sub Category -> Jenis Product -> Platform -> Jenis
// Toko dropdowns, options always filtered to combinations that actually
// exist in market_fees — "pick" a fee row, not type one that won't match.
function useFeeCascade(fees: Fee[], sel: { category: string; sub_category: string; jenis_product: string; platform: string; jenis_toko: string }) {
  return useMemo(() => {
    const by = (pred: (f: Fee) => boolean, key: keyof Fee) =>
      Array.from(new Set(fees.filter(pred).map((f) => (f[key] as string) || "").filter(Boolean))).sort();
    const categories = by(() => true, "category");
    const subCategories = by((f) => !sel.category || f.category === sel.category, "sub_category");
    const jenisProducts = by((f) => (!sel.category || f.category === sel.category) && (!sel.sub_category || f.sub_category === sel.sub_category), "jenis_product");
    const platforms = by((f) => (!sel.category || f.category === sel.category) && (!sel.sub_category || f.sub_category === sel.sub_category) && (!sel.jenis_product || f.jenis_product === sel.jenis_product), "platform");
    const jenisTokos = by((f) =>
      (!sel.category || f.category === sel.category) && (!sel.sub_category || f.sub_category === sel.sub_category) &&
      (!sel.jenis_product || f.jenis_product === sel.jenis_product) && (!sel.platform || f.platform === sel.platform), "jenis_toko");
    return { categories, subCategories, jenisProducts, platforms, jenisTokos };
  }, [fees, sel.category, sel.sub_category, sel.jenis_product, sel.platform, sel.jenis_toko]);
}

function ItemRow({ no, item, fees, feeMap, canEdit, onPatch, onDelete }: {
  no: number; item: Item; fees: Fee[]; feeMap: Map<string, Fee>; canEdit: boolean;
  onPatch: (patch: Partial<Item>) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(item.item_name);
  const [modal, setModal] = useState(formatRp(item.modal_produk_rp));
  const [harga, setHarga] = useState(formatRp(item.harga_jual_rp));
  const [berat, setBerat] = useState(String(item.weight_kg || 0));
  const [volume, setVolume] = useState(String(item.volume_cm3 || 0));

  const sel = {
    category: item.category || "", sub_category: item.sub_category || "", jenis_product: item.jenis_product || "",
    platform: item.platform || "", jenis_toko: item.jenis_toko || "",
  };
  const cascade = useFeeCascade(fees, sel);

  // Live preview from local (not-yet-saved) input state — this is what
  // makes Total Biaya/Profit "update live" as you type, independent of
  // whether the blur-triggered save to the DB has landed yet.
  const liveItem: Item = { ...item, modal_produk_rp: parseRp(modal), harga_jual_rp: parseRp(harga), weight_kg: Number(berat) || 0, volume_cm3: Number(volume) || 0 };
  const fee = feeMap.get(feeKey(item)) || null;
  const { totalBiaya, profit } = computeBiaya(liveItem, fee);
  const marginPct = liveItem.harga_jual_rp > 0 ? (profit / liveItem.harga_jual_rp) * 100 : 0;

  function selectField(field: "category" | "sub_category" | "jenis_product" | "platform" | "jenis_toko") {
    return (v: string) => onPatch({ [field]: v || null } as Partial<Item>);
  }

  return (
    <tr>
      <td className="num" style={{ color: "var(--muted)" }}>{no}</td>
      <td>
        {canEdit ? (
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== item.item_name && onPatch({ item_name: name })}
            style={{ ...textCellStyle, width: 160 }} />
        ) : item.item_name}
      </td>
      {(["category", "sub_category", "jenis_product", "platform", "jenis_toko"] as const).map((field) => (
        <td key={field} style={{ whiteSpace: "nowrap" }}>
          {canEdit ? (
            <select value={sel[field]} onChange={(e) => selectField(field)(e.target.value)} style={{ ...textCellStyle, width: 130 }}>
              <option value="">—</option>
              {cascade[field === "category" ? "categories" : field === "sub_category" ? "subCategories" : field === "jenis_product" ? "jenisProducts" : field === "platform" ? "platforms" : "jenisTokos"].map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (sel[field] || "—")}
        </td>
      ))}
      <td className="num">
        {canEdit ? (
          <input type="text" inputMode="decimal" value={berat} onChange={(e) => setBerat(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={() => Number(berat) !== item.weight_kg && onPatch({ weight_kg: Number(berat) || 0 })}
            style={{ ...numCellStyle, width: 56 }} />
        ) : item.weight_kg}
      </td>
      <td className="num">
        {canEdit ? (
          <input type="text" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={() => Number(volume) !== item.volume_cm3 && onPatch({ volume_cm3: Number(volume) || 0 })}
            style={{ ...numCellStyle, width: 70 }} />
        ) : item.volume_cm3}
      </td>
      <td className="num">
        {canEdit ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--muted)" }}>Rp</span>
            <input type="text" inputMode="numeric" value={modal}
              onChange={(e) => setModal(formatRp(parseRp(e.target.value)))}
              onBlur={() => parseRp(modal) !== item.modal_produk_rp && onPatch({ modal_produk_rp: parseRp(modal) })}
              style={{ ...numCellStyle, width: 84 }} />
          </span>
        ) : "Rp " + formatRp(item.modal_produk_rp)}
      </td>
      <td className="num">
        {canEdit ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--muted)" }}>Rp</span>
            <input type="text" inputMode="numeric" value={harga}
              onChange={(e) => setHarga(formatRp(parseRp(e.target.value)))}
              onBlur={() => parseRp(harga) !== item.harga_jual_rp && onPatch({ harga_jual_rp: parseRp(harga) })}
              style={{ ...numCellStyle, width: 90 }} />
          </span>
        ) : "Rp " + formatRp(item.harga_jual_rp)}
      </td>
      <td className="num" style={{ color: "var(--muted)" }}>{marginPct.toFixed(1)}%</td>
      <td className="num">Rp {formatRp(totalBiaya)}</td>
      <td className="num" style={{ fontWeight: 700, color: profit >= 0 ? "var(--gold)" : "#f87171" }}>Rp {formatRp(profit)}</td>
      <td style={{ fontSize: 11.5, color: fee ? "var(--muted)" : "#f87171", whiteSpace: "nowrap" }}>
        {fee ? fee.category : "No fee matched"}
      </td>
      {canEdit && <td><button onClick={onDelete} style={delBtnStyle}>Delete</button></td>}
    </tr>
  );
}

function AddProductModal({ fees, onAdd, onClose }: {
  fees: Fee[];
  onAdd: (row: Omit<Item, "id">) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    item_name: "", category: "", sub_category: "", jenis_product: "", platform: "Shopee", jenis_toko: "",
    modal_produk_rp: 0, harga_jual_rp: 0, weight_kg: 0, volume_cm3: 0,
  });
  const cascade = useFeeCascade(fees, f);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 14px" }}>Add Product</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <ModalField label="Item Product" full><input style={inputStyle} value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} /></ModalField>
          <ModalField label="Category">
            <select style={inputStyle} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, sub_category: "", jenis_product: "" })}>
              <option value="">—</option>{cascade.categories.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </ModalField>
          <ModalField label="Sub Category">
            <select style={inputStyle} value={f.sub_category} onChange={(e) => setF({ ...f, sub_category: e.target.value, jenis_product: "" })}>
              <option value="">—</option>{cascade.subCategories.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </ModalField>
          <ModalField label="Jenis Product">
            <select style={inputStyle} value={f.jenis_product} onChange={(e) => setF({ ...f, jenis_product: e.target.value })}>
              <option value="">—</option>{cascade.jenisProducts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </ModalField>
          <ModalField label="Platform">
            <select style={inputStyle} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value, jenis_toko: "" })}>
              <option value="">—</option>{cascade.platforms.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </ModalField>
          <ModalField label="Jenis Toko">
            <select style={inputStyle} value={f.jenis_toko} onChange={(e) => setF({ ...f, jenis_toko: e.target.value })}>
              <option value="">—</option>{cascade.jenisTokos.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </ModalField>
          <ModalField label="Modal Produk">
            <input type="text" inputMode="numeric" style={inputStyle} value={formatRp(f.modal_produk_rp)} onChange={(e) => setF({ ...f, modal_produk_rp: parseRp(e.target.value) })} />
          </ModalField>
          <ModalField label="Harga Jual">
            <input type="text" inputMode="numeric" style={inputStyle} value={formatRp(f.harga_jual_rp)} onChange={(e) => setF({ ...f, harga_jual_rp: parseRp(e.target.value) })} />
          </ModalField>
          <ModalField label="Berat (Kg)">
            <input type="text" inputMode="decimal" style={inputStyle} value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
          </ModalField>
          <ModalField label="Volume (cm³)">
            <input type="text" inputMode="decimal" style={inputStyle} value={f.volume_cm3} onChange={(e) => setF({ ...f, volume_cm3: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
          </ModalField>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-gold" disabled={!f.item_name} onClick={() => onAdd(f)}>Add</button>
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

const stickyTh: React.CSSProperties = { position: "sticky", top: 0, zIndex: 1 };
const textCellStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 };
const numCellStyle: React.CSSProperties = { textAlign: "right", background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12.5 };
const inputStyle: React.CSSProperties = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%", boxSizing: "border-box" };
const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const dialog: React.CSSProperties = { width: "min(96vw,760px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
