"use client";

import { useState } from "react";
import type { DataSource } from "@/lib/parse";

const SLOTS: { source: DataSource; label: string; hint: string; accept: string }[] = [
  { source: "perf", label: "Performa", hint: "sales_overview", accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "SPOS", hint: "parentskudetail", accept: ".xlsx,.xls,.csv" },
  { source: "ads", label: "Ads", hint: "Data Keseluruhan Iklan", accept: ".xlsx,.xls,.csv" },
];

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

export default function UploadPage() {
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [manual, setManual] = useState({
    admin: "", bulan: "Juni", year: new Date().getFullYear(),
    city: "", pic_client: "", store_name: "", week: "W1", tanggal_mulai: "",
  });
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  function setField<K extends keyof typeof manual>(k: K, v: (typeof manual)[K]) {
    setManual((m) => ({ ...m, [k]: v }));
  }

  async function submit() {
    setBusy(true); setLog([]);
    const chosen = SLOTS.filter((s) => files[s.source]);
    if (!chosen.length) { setLog(["Pick at least one file."]); setBusy(false); return; }
    for (const slot of chosen) {
      const fd = new FormData();
      fd.append("file", files[slot.source]!);
      fd.append("source", slot.source);
      fd.append("manual", JSON.stringify(manual));
      if (clientId) fd.append("client_id", clientId);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await res.json();
        setLog((l) => [...l, res.ok ? `✓ ${slot.label}: ${j.rows} rows` : `✗ ${slot.label}: ${j.error}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
      }
    }
    setBusy(false);
  }

  return (
    <>
      <div className="panel">
        <h3>Upload Shopee Data</h3>
        <div className="hint">Pick the week&apos;s details once, attach one or more exports (Performa / SPOS / Ads), then Upload. Brand &amp; Tipe Produk are auto-detected.</div>

        <div className="upl-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 16 }}>
          <Field label="Client ID (superadmin)"><input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="blank if scoped" /></Field>
          <Field label="Admin"><input value={manual.admin} onChange={(e) => setField("admin", e.target.value)} /></Field>
          <Field label="Bulan">
            <select value={manual.bulan} onChange={(e) => setField("bulan", e.target.value)}>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
            </select></Field>
          <Field label="Year"><input type="number" value={manual.year} onChange={(e) => setField("year", Number(e.target.value))} /></Field>
          <Field label="Week"><input value={manual.week} onChange={(e) => setField("week", e.target.value)} /></Field>
          <Field label="City"><input value={manual.city} onChange={(e) => setField("city", e.target.value)} /></Field>
          <Field label="PIC"><input value={manual.pic_client} onChange={(e) => setField("pic_client", e.target.value)} /></Field>
          <Field label="Store Name"><input value={manual.store_name} onChange={(e) => setField("store_name", e.target.value)} /></Field>
          <Field label="Tanggal Mulai"><input type="date" value={manual.tanggal_mulai} onChange={(e) => setField("tanggal_mulai", e.target.value)} /></Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, margin: "20px 0 8px", padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)" }}>
          {SLOTS.map((s) => (
            <div key={s.source}>
              <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600 }}>
                {s.label} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>({s.hint})</span>
              </label>
              <input type="file" accept={s.accept} style={{ fontSize: 12, color: "#bcd", display: "block", marginTop: 6, width: "100%" }}
                onChange={(e) => setFiles((f) => ({ ...f, [s.source]: e.target.files?.[0] ?? null }))} />
              {files[s.source] && <p style={{ marginTop: 6, fontSize: 11, color: "var(--gold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {files[s.source]!.name}</p>}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center", marginTop: 14 }}>
          <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16 }}>
            {log.map((l, i) => <div key={i} style={{ color: l.startsWith("✓") ? "var(--gold)" : "#f87171", marginBottom: 4 }}>{l}</div>)}
          </div>
        )}
      </div>
    </>
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
