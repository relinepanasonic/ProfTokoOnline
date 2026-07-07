"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

type UploadRow = {
  id: string; filename: string | null; row_count: number; created_at: string;
  meta: { month?: string } | null;
};

export default function MarketFeeUpload({ clientId, onUploaded }: { clientId: string; onUploaded: () => void }) {
  const [supabase] = useState(() => createClient());
  const [file, setFile] = useState<File | null>(null);
  const now = new Date();
  const [monthName, setMonthName] = useState(MONTHS[now.getMonth()]);
  const [year, setYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [uploads, setUploads] = useState<UploadRow[]>([]);

  const loadUploads = useCallback(async (cid: string) => {
    const { data } = await supabase.from("uploads")
      .select("id,filename,row_count,created_at,meta")
      .eq("client_id", cid).eq("source", "market_fee")
      .order("created_at", { ascending: false });
    setUploads((data as UploadRow[]) || []);
  }, [supabase]);

  useEffect(() => {
    if (!clientId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUploads(clientId);
  }, [clientId, loadUploads]);

  async function submit() {
    if (!file) { setLog("Pick a file first."); return; }
    setBusy(true); setLog("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("client_id", clientId);
    fd.append("month", `${monthName} ${year}`);
    try {
      const res = await fetch("/api/marketfee/upload", { method: "POST", body: fd });
      const j = await res.json();
      setLog(res.ok
        ? `✓ ${j.rows} baris diproses — ${j.changed} nilai berubah (${j.new_items} item baru), dicatat sebagai "${monthName} ${year}"`
        : `✗ ${j.error}`);
      if (res.ok) { setFile(null); loadUploads(clientId); onUploaded(); }
    } catch (e) { setLog("✗ " + String(e)); }
    setBusy(false);
  }

  async function del(id: string) {
    if (!confirm("Delete this upload record? (This does not revert the fee values it changed.)")) return;
    await supabase.from("uploads").delete().eq("id", id);
    loadUploads(clientId);
  }

  return (
    <div className="panel">
      <h3>Upload Market Place Fee</h3>
      <div className="hint" style={{ marginBottom: 16 }}>
        Upload the &quot;Market Place Fee&quot; list (CSV or Excel, same columns as the Calculator sheet). Existing items are updated in place —
        every changed number is logged under the Update Month below (Edit Log tab shows Month + who uploaded it). New items are added, nothing is deleted.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 20 }}>
        <Field label="Update Month">
          <select value={monthName} onChange={(e) => setMonthName(e.target.value)}>
            {MONTHS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600 }}>Market Place Fee File <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>(.csv / .xlsx)</span></label>
          <input type="file" accept=".csv,.xlsx,.xls" style={{ fontSize: 12, color: "#bcd", display: "block", marginTop: 6, width: "100%" }}
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

      {uploads.length > 0 && (
        <div className="tbl-wrap" style={{ marginTop: 20 }}>
          <table className="tbl">
            <thead><tr><th>Month</th><th className="num">Rows</th><th>File</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>{u.meta?.month || "—"}</td>
                  <td className="num">{u.row_count?.toLocaleString("id-ID") || 0}</td>
                  <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.filename || ""}>{u.filename || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString("id-ID")}</td>
                  <td><button onClick={() => del(u.id)} style={delBtn}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
const delBtn: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
