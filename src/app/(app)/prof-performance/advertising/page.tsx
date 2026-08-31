"use client";

// Prof Performance > Advertising — Superadmin + Advertiser only (client_admin
// does not get this one; see shared.tsx). Staff upload a screenshot of
// Shopee's "Iklan Produk Otomatis" table; it's OCR'd client-side (no AI
// vision API — see lib/adsPhotoOcr.ts) into an editable draft the staff
// reviews/corrects before saving. Filter bar matches the main Dashboard's
// own (Year/Month/Owner/Brand/Store + Reset).

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useStaffOnly, ProfPerfTabs } from "../shared";
import { runAdsPhotoOcr, type OcrRow } from "@/lib/adsPhotoOcr";

export const dynamic = "force-dynamic";

const ADVERTISING_ROLES = ["superadmin", "advertiser"] as const;
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2].map(String);

type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };
type CaptureItem = {
  id: string; owner: string | null; brand: string | null; store_name: string | null;
  year: number | null; month: string | null; product_name: string;
  views: number | null; clicks: number | null; ad_cost: number | null;
  sales: number | null; conversion: number | null; items_sold: number | null;
  created_at: string;
};

const idr = (n: number | null) => (n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const num = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("id-ID").format(Math.round(n)));
function emptyRow(): OcrRow {
  return { product_name: "", views: null, clicks: null, ad_cost: null, sales: null, conversion: null, items_sold: null };
}

export default function AdvertisingPage() {
  const ready = useStaffOnly(ADVERTISING_ROLES);
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [links, setLinks] = useState<StoreLink[]>([]);
  const [sel, setSel] = useState({ year: "", month: "", owner: "", brand: "", store: "" });
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [draftRows, setDraftRows] = useState<OcrRow[]>([]);
  const [draftMeta, setDraftMeta] = useState({ year: "", month: "", owner: "", brand: "", store: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("client_id,role").eq("id", user.id).single();
      const prof = p as { client_id: string | null; role: string } | null;
      // Advertiser is client-scoped; superadmin (global) falls back to the
      // first-created client — same convention Dashboard/AdsOverview/Upload
      // already use for staff logins.
      const cid = prof?.role === "superadmin"
        ? ((await supabase.from("clients").select("id").order("created_at").limit(1)).data as { id: string }[] | null)?.[0]?.id || ""
        : (prof?.client_id || "");
      setClientId(cid);
      const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", cid).order("owner");
      setLinks((sl as StoreLink[]) || []);
    })();
  }, [ready, supabase]);

  const reload = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    let q = supabase.from("ads_photo_capture_items").select("*").eq("client_id", clientId).order("created_at", { ascending: false });
    if (sel.year) q = q.eq("year", Number(sel.year));
    if (sel.month) q = q.eq("month", sel.month);
    if (sel.owner) q = q.eq("owner", sel.owner);
    if (sel.brand) q = q.eq("brand", sel.brand);
    if (sel.store) q = q.eq("store_name", sel.store);
    const { data } = await q;
    setItems((data as CaptureItem[]) || []);
    setLoading(false);
  }, [supabase, clientId, sel]);
  useEffect(() => { reload(); }, [reload]);

  const owners = Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort();
  const brandsFor = (o: string) => Array.from(new Set(links.filter((l) => !o || l.owner === o).map((l) => l.brand).filter(Boolean) as string[])).sort();
  const storesFor = (o: string, b: string) =>
    Array.from(new Set(links.filter((l) => (!o || l.owner === o) && (!b || l.brand === b)).map((l) => l.store_name).filter(Boolean) as string[])).sort();

  async function pickFile(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setDraftRows([]);
    setMsg("");
    setOcrBusy(true); setOcrPct(0);
    try {
      const rows = await runAdsPhotoOcr(f, setOcrPct);
      setDraftRows(rows.length ? rows : [emptyRow()]);
      if (!rows.length) setMsg("No table detected — add rows manually below, or try a clearer/larger screenshot.");
    } catch (e) {
      setMsg("✗ OCR failed: " + (e instanceof Error ? e.message : String(e)));
      setDraftRows([emptyRow()]);
    } finally {
      setOcrBusy(false);
    }
  }

  function updateDraftRow(i: number, patch: Partial<OcrRow>) {
    setDraftRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeDraftRow(i: number) {
    setDraftRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function saveCapture() {
    if (!file || !clientId) return;
    if (!draftMeta.store) { setMsg("Select a Store for this capture"); return; }
    const cleanRows = draftRows.filter((r) => r.product_name.trim());
    if (!cleanRows.length) { setMsg("No rows to save — add at least one Iklan Produk row"); return; }
    setSaving(true); setMsg("");
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${clientId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("ads-captures").upload(path, file);
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      const { data: cap, error: capErr } = await supabase.from("ads_photo_captures").insert({
        client_id: clientId, owner: draftMeta.owner || null, brand: draftMeta.brand || null,
        store_name: draftMeta.store || null, year: draftMeta.year ? Number(draftMeta.year) : null,
        month: draftMeta.month || null, image_path: path, uploaded_by: user?.id || null,
      }).select("id").single();
      if (capErr) throw capErr;

      const rowsToInsert = cleanRows.map((r) => ({
        capture_id: cap.id, client_id: clientId, owner: draftMeta.owner || null, brand: draftMeta.brand || null,
        store_name: draftMeta.store || null, year: draftMeta.year ? Number(draftMeta.year) : null, month: draftMeta.month || null,
        product_name: r.product_name.trim(), views: r.views, clicks: r.clicks, ad_cost: r.ad_cost,
        sales: r.sales, conversion: r.conversion, items_sold: r.items_sold,
      }));
      const { error: itemsErr } = await supabase.from("ads_photo_capture_items").insert(rowsToInsert);
      if (itemsErr) throw itemsErr;

      setMsg(`✓ Saved ${rowsToInsert.length} row(s)`);
      setFile(null); setPreview(""); setDraftRows([]);
      setDraftMeta({ year: "", month: "", owner: "", brand: "", store: "" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      reload();
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <Loader center />;

  return (
    <>
      <ProfPerfTabs active="/prof-performance/advertising" />

      {/* ── Filters — same shape as the main Dashboard's ── */}
      <div className="filterbar">
        <Sel label="Year" value={sel.year} onChange={(v) => setSel((s) => ({ ...s, year: v }))} opts={YEARS} all="All Years" />
        <Sel label="Month" value={sel.month} onChange={(v) => setSel((s) => ({ ...s, month: v }))} opts={MONTHS} all="All Months" />
        <Sel label="Owner" value={sel.owner} onChange={(v) => setSel((s) => ({ ...s, owner: v, brand: "", store: "" }))} opts={owners} all="All Owners" />
        <Sel label="Brand" value={sel.brand} onChange={(v) => setSel((s) => ({ ...s, brand: v, store: "" }))} opts={brandsFor(sel.owner)} all="All Brands" />
        <Sel label="Store" value={sel.store} onChange={(v) => setSel((s) => ({ ...s, store: v }))} opts={storesFor(sel.owner, sel.brand)} all="All Store" />
        <button className="btn-ghost" onClick={() => setSel({ year: "", month: "", owner: "", brand: "", store: "" })}>Reset</button>
        {loading && <Loader />}
      </div>

      {/* ── Upload + OCR draft ── */}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 4px" }}>Upload Ads Screenshot</h3>
        <div className="hint" style={{ marginBottom: 14 }}>
          "Iklan Produk Otomatis" table — Iklan Produk, Iklan Dilihat, Jumlah Klik, Biaya Iklan, Penjualan, Konversi, Prod Terjual.
          Read automatically in your browser (no AI service, nothing uploaded anywhere for analysis) — always check the rows below before saving, table OCR is never perfect.
        </div>
        <input
          ref={fileInputRef} type="file" accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
          style={{ marginBottom: 14, fontSize: 13 }}
        />

        {preview && (
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" style={{ maxWidth: 260, maxHeight: 260, borderRadius: 10, border: "1px solid var(--line)", objectFit: "contain" }} />
            <div style={{ flex: 1, minWidth: 260, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <MiniSel label="Year" value={draftMeta.year} onChange={(v) => setDraftMeta((m) => ({ ...m, year: v }))} opts={YEARS} placeholder="—" />
              <MiniSel label="Month" value={draftMeta.month} onChange={(v) => setDraftMeta((m) => ({ ...m, month: v }))} opts={MONTHS} placeholder="—" />
              <MiniSel label="Owner" value={draftMeta.owner} onChange={(v) => setDraftMeta((m) => ({ ...m, owner: v, brand: "", store: "" }))} opts={owners} placeholder="—" />
              <MiniSel label="Brand" value={draftMeta.brand} onChange={(v) => setDraftMeta((m) => ({ ...m, brand: v, store: "" }))} opts={brandsFor(draftMeta.owner)} placeholder="—" />
              <MiniSel label="Store *" value={draftMeta.store} onChange={(v) => setDraftMeta((m) => ({ ...m, store: v }))} opts={storesFor(draftMeta.owner, draftMeta.brand)} placeholder="Required" />
            </div>
          </div>
        )}

        {ocrBusy && <div className="hint" style={{ marginBottom: 10 }}>⏳ Reading image… {ocrPct}%</div>}

        {draftRows.length > 0 && (
          <>
            <div className="tbl-wrap" style={{ marginBottom: 10 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Iklan Produk</th><th>Iklan Dilihat</th><th>Jumlah Klik</th><th>Biaya Iklan</th>
                    <th>Penjualan</th><th>Konversi</th><th>Prod Terjual</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {draftRows.map((r, i) => (
                    <tr key={i}>
                      <td><input value={r.product_name} onChange={(e) => updateDraftRow(i, { product_name: e.target.value })} style={cellInput} /></td>
                      <NumCell v={r.views} onChange={(v) => updateDraftRow(i, { views: v })} />
                      <NumCell v={r.clicks} onChange={(v) => updateDraftRow(i, { clicks: v })} />
                      <NumCell v={r.ad_cost} onChange={(v) => updateDraftRow(i, { ad_cost: v })} />
                      <NumCell v={r.sales} onChange={(v) => updateDraftRow(i, { sales: v })} />
                      <NumCell v={r.conversion} onChange={(v) => updateDraftRow(i, { conversion: v })} />
                      <NumCell v={r.items_sold} onChange={(v) => updateDraftRow(i, { items_sold: v })} />
                      <td><button onClick={() => removeDraftRow(i)} title="Remove row" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn-ghost" onClick={() => setDraftRows((r) => [...r, emptyRow()])}>+ Add row</button>
              <button className="btn-gold" disabled={saving} onClick={saveCapture}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </>
        )}

        {msg && (
          <div style={{ marginTop: 12, fontSize: 13, padding: "8px 12px", borderRadius: 10,
            color: msg.startsWith("✓") ? "#86efac" : "#ff9a9a",
            background: msg.startsWith("✓") ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
            border: msg.startsWith("✓") ? "1px solid rgba(34,197,94,.2)" : "1px solid rgba(239,68,68,.2)" }}>
            {msg}
          </div>
        )}
      </div>

      {/* ── Saved rows ── */}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 4px" }}>Captured Ads Performance</h3>
        <div className="hint" style={{ marginBottom: 12 }}>{items.length} row(s) matching the filters above</div>
        <div className="tbl-wrap" style={{ maxHeight: 480 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Iklan Produk</th><th>Owner</th><th>Brand</th><th>Store</th><th>Period</th>
                <th>Iklan Dilihat</th><th>Jumlah Klik</th><th>Biaya Iklan</th><th>Penjualan</th><th>Konversi</th><th>Prod Terjual</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.product_name}</td>
                  <td>{it.owner || "—"}</td>
                  <td>{it.brand || "—"}</td>
                  <td>{it.store_name || "—"}</td>
                  <td>{[it.month, it.year].filter(Boolean).join(" ") || "—"}</td>
                  <td>{num(it.views)}</td>
                  <td>{num(it.clicks)}</td>
                  <td>{idr(it.ad_cost)}</td>
                  <td>{idr(it.sales)}</td>
                  <td>{num(it.conversion)}</td>
                  <td>{num(it.items_sold)}</td>
                </tr>
              ))}
              {!items.length && !loading && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No captures yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── building blocks ── */
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
function MiniSel({ label, value, onChange, opts, placeholder }: { label: string; value: string; onChange: (v: string) => void; opts: string[]; placeholder: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={cellInput}>
        <option value="">{placeholder}</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function NumCell({ v, onChange }: { v: number | null; onChange: (n: number | null) => void }) {
  return (
    <td>
      <input
        value={v ?? ""} inputMode="decimal" style={{ ...cellInput, width: 92, textAlign: "right" }}
        onChange={(e) => { const raw = e.target.value.trim(); onChange(raw === "" ? null : Number(raw.replace(/[^\d.-]/g, "")) || null); }}
      />
    </td>
  );
}

const cellInput: React.CSSProperties = {
  width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(201,162,39,.22)",
  background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 12.5, outline: "none", boxSizing: "border-box",
};
