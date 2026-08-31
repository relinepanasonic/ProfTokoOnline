"use client";

// Prof Performance > Advertising — Superadmin + Advertiser only (client_admin
// does not get this one; see shared.tsx).
//
// Flow: pick a Store, click "Record Ads" (top-right of the log table) to
// open a session. Inside that session, upload/paste 2-5 screenshots of
// Shopee's "Iklan Produk Otomatis" table one at a time — each is OCR'd
// client-side (no AI vision API — see lib/adsPhotoOcr.ts) and its rows
// are appended to one running draft table for the whole session, which
// staff reviews/corrects before a single Save. The log table below lists
// past sessions by an automatic Date & Time stamp (not user-editable —
// that IS what distinguishes a day's 2-3 recording sessions from each
// other) with a Store/Owner/Brand and screenshot/row counts.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
type SessionRow = {
  id: string; owner: string | null; brand: string | null; store_name: string;
  created_at: string; shots: number; rows: number;
};

const idr = (n: number | null) => (n == null ? "—" : "Rp " + Math.round(n).toLocaleString("id-ID"));
const num = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("id-ID").format(Math.round(n)));
const fmtDT = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

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

    let sq = supabase.from("ads_sessions").select("id,owner,brand,store_name,created_at").eq("client_id", clientId).order("created_at", { ascending: false });
    if (sel.owner) sq = sq.eq("owner", sel.owner);
    if (sel.brand) sq = sq.eq("brand", sel.brand);
    if (sel.store) sq = sq.eq("store_name", sel.store);
    if (sel.year) sq = sq.gte("created_at", `${sel.year}-01-01`).lt("created_at", `${Number(sel.year) + 1}-01-01`);
    const { data: sessData } = await sq;
    const sessRows = (sessData as { id: string; owner: string | null; brand: string | null; store_name: string; created_at: string }[]) || [];

    let counts: Record<string, { shots: number; rows: number }> = {};
    if (sessRows.length) {
      const ids = sessRows.map((s) => s.id);
      const [{ data: caps }, { data: its }] = await Promise.all([
        supabase.from("ads_photo_captures").select("session_id").in("session_id", ids),
        supabase.from("ads_photo_capture_items").select("session_id").in("session_id", ids),
      ]);
      counts = {};
      for (const c of (caps as { session_id: string }[]) || []) counts[c.session_id] = { shots: (counts[c.session_id]?.shots || 0) + 1, rows: counts[c.session_id]?.rows || 0 };
      for (const it of (its as { session_id: string }[]) || []) counts[it.session_id] = { shots: counts[it.session_id]?.shots || 0, rows: (counts[it.session_id]?.rows || 0) + 1 };
    }
    setSessions(sessRows.map((s) => ({ ...s, shots: counts[s.id]?.shots || 0, rows: counts[s.id]?.rows || 0 })));

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

      {/* ── Log ── */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Advertising Log</h3>
          <button className="btn-gold" onClick={() => setRecordOpen(true)}>⏺ Record Ads</button>
        </div>
        <div className="hint" style={{ marginBottom: 12 }}>{sessions.length} session(s) matching the filters above</div>
        <div className="tbl-wrap" style={{ maxHeight: 360 }}>
          <table className="tbl">
            <thead><tr><th>Date &amp; Time</th><th>Store</th><th>Owner</th><th>Brand</th><th>Screenshots</th><th>Rows</th></tr></thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDT(s.created_at)}</td>
                  <td>{s.store_name}</td>
                  <td>{s.owner || "—"}</td>
                  <td>{s.brand || "—"}</td>
                  <td>{s.shots}</td>
                  <td>{s.rows}</td>
                </tr>
              ))}
              {!sessions.length && !loading && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No recording sessions yet — click "Record Ads" to start one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── All rows (flat, filterable) ── */}
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

      {recordOpen && (
        <RecordAdsModal
          supabase={supabase} clientId={clientId} links={links}
          owners={owners} brandsFor={brandsFor} storesFor={storesFor}
          onClose={() => setRecordOpen(false)}
          onSaved={() => { setRecordOpen(false); reload(); }}
        />
      )}
    </>
  );
}

/* ═══════════════════════ Record Ads modal ═══════════════════════ */
function RecordAdsModal({ supabase, clientId, links, owners, brandsFor, storesFor, onClose, onSaved }: {
  supabase: ReturnType<typeof createClient>; clientId: string; links: StoreLink[];
  owners: string[]; brandsFor: (o: string) => string[]; storesFor: (o: string, b: string) => string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [meta, setMeta] = useState({ owner: "", brand: "", store: "" });
  const [shots, setShots] = useState<{ file: File; preview: string; status: "ocr" | "done" | "error"; error?: string }[]>([]);
  const [draftRows, setDraftRows] = useState<OcrRow[]>([]);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [productHistory, setProductHistory] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "The Iklan Produk we already use before" — every distinct product/group
  // name previously logged for this store, offered as suggestions (not a
  // locked dropdown — a genuinely new ad still just gets typed in).
  useEffect(() => {
    if (!meta.store || !clientId) { setProductHistory([]); return; }
    (async () => {
      const { data } = await supabase.from("ads_photo_capture_items").select("product_name").eq("client_id", clientId).eq("store_name", meta.store).limit(500);
      setProductHistory(Array.from(new Set(((data as { product_name: string }[]) || []).map((r) => r.product_name))).sort());
    })();
  }, [supabase, clientId, meta.store]);

  async function addShot(f: File) {
    if (!meta.store) { setMsg("Select a Store first"); return; }
    const preview = URL.createObjectURL(f);
    setShots((s) => [...s, { file: f, preview, status: "ocr" }]);
    setMsg("");
    setOcrBusy(true); setOcrPct(0);
    try {
      const rows = await runAdsPhotoOcr(f, setOcrPct);
      setShots((s) => s.map((x) => (x.file === f ? { ...x, status: "done" } : x)));
      setDraftRows((prev) => [...prev, ...(rows.length ? rows : [])]);
      if (!rows.length) setMsg("That screenshot didn't produce any rows — add them manually below, or try a clearer image.");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setShots((s) => s.map((x) => (x.file === f ? { ...x, status: "error", error: errMsg } : x)));
      setMsg("✗ OCR failed on one screenshot: " + errMsg);
    } finally {
      setOcrBusy(false);
    }
  }

  // Paste support scoped to while this modal is open.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith("image/"));
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      e.preventDefault();
      addShot(new File([blob], `pasted-${Date.now()}.${blob.type.split("/")[1] || "png"}`, { type: blob.type }));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.store]);

  function updateDraftRow(i: number, patch: Partial<OcrRow>) {
    setDraftRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeDraftRow(i: number) {
    setDraftRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  async function saveSession() {
    if (!clientId || !meta.store) { setMsg("Select a Store"); return; }
    const cleanRows = draftRows.filter((r) => r.product_name.trim());
    if (!cleanRows.length) { setMsg("No rows to save — add at least one Iklan Produk row"); return; }
    setSaving(true); setMsg("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: session, error: sessErr } = await supabase.from("ads_sessions").insert({
        client_id: clientId, owner: meta.owner || null, brand: meta.brand || null, store_name: meta.store, created_by: user?.id || null,
      }).select("id").single();
      if (sessErr) throw sessErr;

      for (const shot of shots) {
        const ext = shot.file.name.split(".").pop() || "png";
        const path = `${clientId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("ads-captures").upload(path, shot.file);
        if (upErr) throw upErr;
        await supabase.from("ads_photo_captures").insert({
          client_id: clientId, session_id: session.id, owner: meta.owner || null, brand: meta.brand || null,
          store_name: meta.store, image_path: path, uploaded_by: user?.id || null,
        });
      }

      const now = new Date();
      const rowsToInsert = cleanRows.map((r) => ({
        session_id: session.id, client_id: clientId, owner: meta.owner || null, brand: meta.brand || null,
        store_name: meta.store, year: now.getFullYear(), month: MONTHS[now.getMonth()],
        product_name: r.product_name.trim(), views: r.views, clicks: r.clicks, ad_cost: r.ad_cost,
        sales: r.sales, conversion: r.conversion, items_sold: r.items_sold,
      }));
      const { error: itemsErr } = await supabase.from("ads_photo_capture_items").insert(rowsToInsert);
      if (itemsErr) throw itemsErr;

      onSaved();
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(2,6,16,.8)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(96vw,980px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 26, boxShadow: "0 30px 80px rgba(0,0,0,.7)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0 }}>Record Ads</h3>
            <div className="hint">Pick the Store, then upload/paste each screenshot — they all feed into one session below.</div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
          <MiniSel label="Owner" value={meta.owner} onChange={(v) => setMeta((m) => ({ ...m, owner: v, brand: "", store: "" }))} opts={owners} placeholder="—" />
          <MiniSel label="Brand" value={meta.brand} onChange={(v) => setMeta((m) => ({ ...m, brand: v, store: "" }))} opts={brandsFor(meta.owner)} placeholder="—" />
          <MiniSel label="Store *" value={meta.store} onChange={(v) => {
            const link = links.find((l) => l.store_name === v);
            setMeta({ store: v, owner: link?.owner || meta.owner, brand: link?.brand || meta.brand });
          }} opts={storesFor(meta.owner, meta.brand)} placeholder="Required" />
        </div>

        <div style={{ opacity: meta.store ? 1 : 0.5, pointerEvents: meta.store ? "auto" : "none" }}>
          <input
            ref={fileInputRef} type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addShot(f); if (fileInputRef.current) fileInputRef.current.value = ""; }}
            style={{ marginBottom: 6, fontSize: 13 }}
          />
          <div className="hint" style={{ marginBottom: 14 }}>
            Add one screenshot at a time (2-5 per session is normal) — or press <b>Ctrl+V</b> (⌘V on Mac) to paste one in directly.
          </div>

          {shots.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {shots.map((s, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.preview} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", opacity: s.status === "error" ? 0.4 : 1 }} />
                  <span style={{ position: "absolute", bottom: 2, right: 2, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 999,
                    background: s.status === "done" ? "rgba(34,197,94,.85)" : s.status === "error" ? "rgba(239,68,68,.85)" : "rgba(201,162,39,.85)", color: "#0a1628" }}>
                    {s.status === "ocr" ? "…" : s.status === "done" ? "✓" : "✗"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {ocrBusy && <div className="hint" style={{ marginBottom: 10 }}>⏳ Reading image… {ocrPct}%</div>}

          <datalist id="ads-product-history">
            {productHistory.map((p) => <option key={p} value={p} />)}
          </datalist>

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
                    <td><input list="ads-product-history" value={r.product_name} onChange={(e) => updateDraftRow(i, { product_name: e.target.value })} style={cellInput} placeholder="Type or pick a previous one" /></td>
                    <NumCell v={r.views} onChange={(v) => updateDraftRow(i, { views: v })} />
                    <NumCell v={r.clicks} onChange={(v) => updateDraftRow(i, { clicks: v })} />
                    <NumCell v={r.ad_cost} onChange={(v) => updateDraftRow(i, { ad_cost: v })} />
                    <NumCell v={r.sales} onChange={(v) => updateDraftRow(i, { sales: v })} />
                    <NumCell v={r.conversion} onChange={(v) => updateDraftRow(i, { conversion: v })} />
                    <NumCell v={r.items_sold} onChange={(v) => updateDraftRow(i, { items_sold: v })} />
                    <td><button onClick={() => removeDraftRow(i)} title="Remove row" style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 15 }}>×</button></td>
                  </tr>
                ))}
                {!draftRows.length && (
                  <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 18 }}>Upload a screenshot above, or add a row manually.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn-ghost" onClick={() => setDraftRows((r) => [...r, emptyRow()])}>+ Add row</button>
            <button className="btn-gold" disabled={saving || !draftRows.length} onClick={saveSession}>{saving ? "Saving…" : "Save Session"}</button>
          </div>
        </div>

        {msg && (
          <div style={{ marginTop: 12, fontSize: 13, padding: "8px 12px", borderRadius: 10,
            color: msg.startsWith("✓") ? "#86efac" : "#ff9a9a",
            background: msg.startsWith("✓") ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
            border: msg.startsWith("✓") ? "1px solid rgba(34,197,94,.2)" : "1px solid rgba(239,68,68,.2)" }}>
            {msg}
          </div>
        )}
      </div>
    </div>,
    document.body
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
