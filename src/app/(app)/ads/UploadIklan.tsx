"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MONTHS, WEEKS, LEVELS, type AdLevel } from "@/lib/adsConstants";

type Link = { owner: string | null; brand: string | null; store_name: string | null };

// Uploads a single Shopee "Data Grup Iklan" / Shop GMV Max export -> ad_groups.
// Rendered both on the Ads Performance page (full level picker) and on the
// consolidated Upload page's "Inkubasi Performa" / "Group Performa" cards
// (level locked or narrowed via props, so the same parser/route/component
// backs all three upload zones — they only differ in which ads_level(s)
// are offered).
export default function UploadIklan({ clientId, supabase, onUploaded, title, hint, lockLevel, levelChoices }: {
  clientId: string; supabase: ReturnType<typeof createClient>; onUploaded: () => void;
  title?: string; hint?: string; lockLevel?: string; levelChoices?: AdLevel[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [m, setM] = useState({ year: new Date().getFullYear(), bulan: "", week: "Week 1", pic_client: "", brand: "", store_name: "", grup_iklan: "", ads_level: lockLevel || "" });
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

  const levelOptions = levelChoices || LEVELS;

  async function submit() {
    if (!file) { setLog("Pick a file first."); return; }
    if (!m.bulan) { setLog("Select Bulan."); return; }
    if (!m.store_name) { setLog("Select Owner → Brand → Dealer."); return; }
    if (!m.ads_level) { setLog("Select Ads Level."); return; }
    setBusy(true); setLog("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("client_id", clientId);
    fd.append("manual", JSON.stringify({ ...m, tanggal_input: new Date().toISOString() }));
    try {
      const res = await fetch("/api/ads-group/upload", { method: "POST", body: fd });
      const j = await res.json();
      setLog(res.ok ? `✓ ${j.grup_iklan || "Grup"}: ${j.rows} rows imported` : `✗ ${j.error}`);
      if (res.ok) { setFile(null); onUploaded(); }
    } catch (e) { setLog("✗ " + String(e)); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h3 style={{ margin: 0 }}>{title || "Upload Iklan"}</h3>
      <div className="hint" style={{ marginBottom: 16 }}>{hint || <>Export <b>one ad group per file</b> from Shopee. Select dealer, level &amp; period, then upload.</>}</div>

      {/* row 1: owner / brand / store / grup / level */}
      <div style={{ display: "grid", gridTemplateColumns: lockLevel ? "repeat(3,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
        <div className="fld"><label>Owner</label>
          <select value={m.pic_client} onChange={(e) => setM((s) => ({ ...s, pic_client: e.target.value, brand: "", store_name: "" }))}>
            <option value="">Select owner…</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="fld"><label>Brand</label>
          <select value={m.brand} onChange={(e) => setM((s) => ({ ...s, brand: e.target.value, store_name: "" }))} disabled={!m.pic_client}>
            <option value="">{m.pic_client ? "Select brand…" : "Owner first"}</option>
            {brandsForOwner.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="fld"><label>Dealer (Nama Toko)</label>
          <select value={m.store_name} onChange={(e) => setM((s) => ({ ...s, store_name: e.target.value }))} disabled={!m.brand}>
            <option value="">{m.brand ? "Select store…" : "Brand first"}</option>
            {storesForBrand.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {!lockLevel && (
          <div className="fld"><label>Ads Level</label>
            <select value={m.ads_level} onChange={(e) => setM((s) => ({ ...s, ads_level: e.target.value }))}>
              <option value="">Select level…</option>
              {levelOptions.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* row 2: grup override / year / bulan / week */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        <div className="fld"><label>Grup Iklan (optional)</label>
          <input value={m.grup_iklan} onChange={(e) => setM((s) => ({ ...s, grup_iklan: e.target.value }))} placeholder="Auto-detected from file" />
        </div>
        <div className="fld"><label>Year</label>
          <input type="number" value={m.year} onChange={(e) => setM((s) => ({ ...s, year: Number(e.target.value) }))} />
        </div>
        <div className="fld"><label>Bulan</label>
          <select value={m.bulan} onChange={(e) => setM((s) => ({ ...s, bulan: e.target.value }))}>
            <option value="">Month…</option>
            {MONTHS.map((mo) => <option key={mo}>{mo}</option>)}
          </select>
        </div>
        <div className="fld"><label>Week</label>
          <select value={m.week} onChange={(e) => setM((s) => ({ ...s, week: e.target.value }))}>
            {WEEKS.map((w) => <option key={w}>{w}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12, color: "#bcd" }} />
        <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "10px 34px" }}>{busy ? "Uploading…" : "Upload Iklan"}</button>
        {log && <span style={{ fontSize: 12.5, fontFamily: "monospace", color: log.startsWith("✓") ? "#86efac" : "#f87171" }}>{log}</span>}
      </div>
    </div>
  );
}
