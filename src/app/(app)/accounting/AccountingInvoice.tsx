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

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Invoice</h3>
          <div className="hint">Service package invoices — synced to Proone Accounting.</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--gold)" }}>{fmtRp(total)} <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>total (filtered)</span></div>
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
