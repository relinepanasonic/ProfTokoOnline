"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Invoice = {
  id: string; owner: string | null; brand: string | null; store_name: string | null;
  package_name: string; package_type: string; price_idr: number;
  start_date: string; end_date: string | null; notes: string | null; created_at: string;
};

function fmtRp(n: number) { return "Rp " + Math.round(n || 0).toLocaleString("id-ID"); }
function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function daysLeft(end: string) {
  const e = new Date(end + "T00:00:00"), n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.ceil((e.getTime() - n.getTime()) / (864e5));
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadInvoicesCSV(rows: Invoice[]) {
  const headers = ["Store", "Owner", "Brand", "Package", "Type", "Price (IDR)", "Start Date", "End Date", "Notes"];
  const lines = rows.map((r) => [
    r.store_name || "", r.owner || "", r.brand || "", r.package_name, r.package_type,
    r.price_idr ?? 0, r.start_date || "", r.end_date || "", r.notes || "",
  ].map(csvEscape).join(","));
  const csv = "﻿" + [headers.join(","), ...lines].join("\n"); // BOM so Excel reads UTF-8 correctly
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoices_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Same records pushed to Proone Accounting via syncToProone() on save —
// read from the local table directly rather than re-fetching an unverified
// external "list invoices" endpoint.
export default function AccountingInvoice() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [flt, setFlt] = useState({ owner: "", month: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
    const cid = (cs as { id: string }[])?.[0]?.id || "";
    if (!cid) { setRows([]); setLoading(false); return; }
    const { data } = await supabase.from("invoices")
      .select("id,owner,brand,store_name,package_name,package_type,price_idr,start_date,end_date,notes,created_at")
      .eq("client_id", cid).order("start_date", { ascending: false });
    setRows((data as Invoice[]) || []);
    setLoading(false);
  }, [supabase]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const owners = Array.from(new Set(rows.map((r) => r.owner).filter(Boolean) as string[])).sort();
  const shown = rows.filter((r) =>
    (!flt.owner || r.owner === flt.owner) && (!flt.month || (r.start_date || "").slice(0, 7) === flt.month)
  );
  const total = shown.reduce((s, r) => s + (r.price_idr || 0), 0);

  const subs = rows.filter((inv) => inv.package_type === "subscription" && inv.end_date);
  const expiringSoon = subs.filter((inv) => { const d = daysLeft(inv.end_date!); return d >= 0 && d <= 30; });
  const overdue = subs.filter((inv) => daysLeft(inv.end_date!) < 0);

  return (
    <div className="panel">
      {(expiringSoon.length > 0 || overdue.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
          {/* left — orange, expiring within 30 days */}
          <div style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 14, padding: "12px 16px" }}>
            <div style={{ fontWeight: 800, color: "#fbbf24", fontSize: 13, marginBottom: 6 }}>
              ⏰ {expiringSoon.length} subscription{expiringSoon.length !== 1 ? "s" : ""} expiring within 30 days
            </div>
            {expiringSoon.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>None</div>
            ) : expiringSoon.map((inv) => { const d = daysLeft(inv.end_date!); return (
              <div key={inv.id} style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                <span style={{ color: d <= 7 ? "#f87171" : "#fbbf24", fontWeight: 700 }}>{d}d left</span>
                {" — "}{[inv.store_name, inv.owner].filter(Boolean).join(" / ")} · {inv.package_name} · ends {fmtDate(inv.end_date!)}
              </div>
            ); })}
          </div>

          {/* right — red, already past due date */}
          <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 14, padding: "12px 16px" }}>
            <div style={{ fontWeight: 800, color: "#f87171", fontSize: 13, marginBottom: 6 }}>
              ⚠ {overdue.length} subscription{overdue.length !== 1 ? "s" : ""} already out of date
            </div>
            {overdue.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>None</div>
            ) : overdue.map((inv) => { const d = daysLeft(inv.end_date!); return (
              <div key={inv.id} style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
                <span style={{ color: "#f87171", fontWeight: 700 }}>{Math.abs(d)}d overdue</span>
                {" — "}{[inv.store_name, inv.owner].filter(Boolean).join(" / ")} · {inv.package_name} · ended {fmtDate(inv.end_date!)}
              </div>
            ); })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Invoice</h3>
          <div className="hint">Service package invoices — synced to Proone Accounting.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold)" }}>{fmtRp(total)} <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>total (filtered)</span></div>
          <button className="btn-gold" onClick={() => downloadInvoicesCSV(shown)} disabled={!shown.length} style={{ padding: "8px 16px", fontSize: 12.5 }}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <div className="fld" style={{ minWidth: 160 }}>
          <label>Owner</label>
          <select value={flt.owner} onChange={(e) => setFlt((f) => ({ ...f, owner: e.target.value }))}>
            <option value="">All owners</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="fld" style={{ minWidth: 160 }}>
          <label>Month</label>
          <input type="month" value={flt.month} onChange={(e) => setFlt((f) => ({ ...f, month: e.target.value }))}
            style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13 }} />
        </div>
        {(flt.owner || flt.month) && (
          <button className="btn-ghost" onClick={() => setFlt({ owner: "", month: "" })} style={{ height: 38 }}>Reset</button>
        )}
        <span style={{ marginLeft: "auto", alignSelf: "flex-end", fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "3px 12px" }}>
          {shown.length} / {rows.length}
        </span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Store</th><th>Owner</th><th>Brand</th><th>Package</th><th className="num">Price</th><th>Start</th><th>End</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.store_name || "—"}</td>
                <td>{r.owner || "—"}</td>
                <td>{r.brand || "—"}</td>
                <td>{r.package_name}</td>
                <td className="num">{fmtRp(r.price_idr)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.start_date)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{r.end_date ? fmtDate(r.end_date) : "—"}</td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                {rows.length ? "No invoices match these filters" : "No invoices yet"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
