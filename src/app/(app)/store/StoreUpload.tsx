"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeJson } from "@/lib/safeJson";

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

type Link = { owner: string | null; brand: string | null; store_name: string | null };

export default function StoreUpload({ clientId, onUploaded }: { clientId: string; onUploaded: () => void }) {
  const [supabase] = useState(() => createClient());
  const [file, setFile] = useState<File | null>(null);
  const [m, setM] = useState({ year: new Date().getFullYear(), bulan: "", pic_client: "", brand: "", store_name: "" });
  const [links, setLinks] = useState<Link[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", clientId).order("created_at");
      setLinks((sl as Link[]) || []);
    })();
  }, [clientId, supabase]);

  const owners = Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort();
  const brandsForOwner = m.pic_client
    ? Array.from(new Set(links.filter((l) => l.owner === m.pic_client).map((l) => l.brand).filter(Boolean) as string[])).sort()
    : Array.from(new Set(links.map((l) => l.brand).filter(Boolean) as string[])).sort();
  const storesForBrand = m.brand
    ? links.filter((l) => l.brand === m.brand && (!m.pic_client || l.owner === m.pic_client)).map((l) => l.store_name).filter(Boolean) as string[]
    : Array.from(new Set(links.map((l) => l.store_name).filter(Boolean) as string[]));

  async function submit() {
    if (!file) { setLog("Pick a file first."); return; }
    if (!m.year || !m.bulan) { setLog("Year and Bulan are required."); return; }
    if (!m.store_name) { setLog("Select Owner → Brand → Store."); return; }
    setBusy(true); setLog("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("client_id", clientId);
    fd.append("manual", JSON.stringify(m));
    try {
      const res = await fetch("/api/store/upload", { method: "POST", body: fd });
      const j = await safeJson(res);
      setLog(res.ok ? `✓ ${j.rows} order rows imported` : `✗ ${j.error}`);
      if (res.ok) { setFile(null); onUploaded(); }
    } catch (e) { setLog("✗ " + String(e)); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h3>Upload Operational Performance</h3>
      <div className="hint" style={{ marginBottom: 16 }}>
        Upload the Shopee &quot;Order.completed&quot; (order-level) export — the sheet is read automatically.
        Week is auto-detected per order from its completion date (Week 1 = days 1–7 of the month you pick).
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 14 }}>
        <Field label="Year">
          <input type="number" value={m.year} onChange={(e) => setM((s) => ({ ...s, year: Number(e.target.value) }))} />
        </Field>
        <Field label="Bulan">
          <select value={m.bulan} onChange={(e) => setM((s) => ({ ...s, bulan: e.target.value }))}>
            <option value="">Month</option>
            {MONTHS.map((mo) => <option key={mo}>{mo}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        <Field label="Owner">
          <select value={m.pic_client} onChange={(e) => setM((s) => ({ ...s, pic_client: e.target.value, brand: "", store_name: "" }))}>
            <option value="">Select owner…</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Brand">
          <select value={m.brand} onChange={(e) => setM((s) => ({ ...s, brand: e.target.value, store_name: "" }))} disabled={!m.pic_client}>
            <option value="">{m.pic_client ? "Select brand…" : "Pick owner first"}</option>
            {brandsForOwner.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Store Name">
          <select value={m.store_name} onChange={(e) => setM((s) => ({ ...s, store_name: e.target.value }))} disabled={!m.brand}>
            <option value="">{m.brand ? "Select store…" : "Pick brand first"}</option>
            {storesForBrand.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600 }}>Order Report <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>(Order.completed)</span></label>
          <input type="file" accept=".xlsx,.xls,.csv" style={{ fontSize: 12, color: "#bcd", display: "block", marginTop: 6, width: "100%" }}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {file.name}</p>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
        <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      {log && (
        <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16, color: log.startsWith("✓") ? "var(--gold)" : "#f87171" }}>
          {log}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}
