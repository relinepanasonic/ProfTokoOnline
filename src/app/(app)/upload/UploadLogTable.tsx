"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// All source values the upload flows behind this page write to "uploads"
// with (market_fee is a separate flow entirely and stays out of this log).
type UploadSource = "perf" | "spos" | "ads" | "ads_group" | "finance" | "orders";

const SRC_LABEL: Record<UploadSource, string> = {
  perf: "Store Performa", spos: "Product Performa", ads: "Ads Performa",
  ads_group: "Grup/Inkubasi", finance: "Finance Detail", orders: "Order Complete",
};
const SRC_COLOR: Record<UploadSource, string> = {
  perf: "#22c55e", spos: "#3b82f6", ads: "#f59e0b",
  ads_group: "#a855f7", finance: "#14b8a6", orders: "#ec4899",
};
const SOURCE_ORDER: UploadSource[] = ["perf", "spos", "ads", "ads_group", "finance", "orders"];

// The 4 log rows the user wants, regardless of which card/button produced
// the underlying uploads rows: Store Performance (perf+spos) always merge,
// Ads Performance (ads+ads_group — covers Ads/Inkubasi/Group alike) always
// merge, Order Complete and Finance Detail each stand alone.
type Category = "store" | "ads" | "order" | "finance";
const CATEGORY_LABEL: Record<Category, string> = { store: "Store Performance", ads: "Ads Performance", order: "Order Complete", finance: "Finance Detail" };
function categoryOf(source: UploadSource): Category {
  if (source === "perf" || source === "spos") return "store";
  if (source === "ads" || source === "ads_group") return "ads";
  if (source === "orders") return "order";
  return "finance";
}

type UploadRow = {
  id: string; source: UploadSource; filename: string | null; row_count: number; created_at: string;
  meta: { pic_client?: string; store_name?: string; bulan?: string; week?: string; year?: number; admin?: string; ads_level?: string } | null;
};

function fmtUploadTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const time = `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day} ${time}`;
}

// Shared Upload Log — same grouped-batch table on both "Upload by Admin"
// and "Upload Here". clientId scopes the query; bump refreshKey after a
// successful upload elsewhere on the page to make this refetch.
export default function UploadLogTable({ clientId, refreshKey }: { clientId: string; refreshKey?: number }) {
  const [supabase] = useState(() => createClient());
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [flt, setFlt] = useState({ year: "", month: "", week: "", owner: "", store: "", category: "" });

  const loadUploads = useCallback(async (cid: string) => {
    if (!cid) { setUploads([]); return; }
    const { data } = await supabase.from("uploads")
      .select("id,source,filename,row_count,created_at,meta")
      .eq("client_id", cid)
      .in("source", SOURCE_ORDER)
      .order("created_at", { ascending: false });
    setUploads((data as UploadRow[]) || []);
  }, [supabase]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadUploads(clientId); }, [clientId, refreshKey, loadUploads]);

  async function delUploads(ids: string[]) {
    if (!confirm(ids.length > 1 ? `Delete this upload (${ids.length} files) and all its rows? This cannot be undone.` : "Delete this upload and all its rows? This cannot be undone.")) return;
    const { error } = await supabase.from("uploads").delete().in("id", ids);
    if (error) { alert(error.message); return; }
    await supabase.rpc("refresh_dashboard_rollup");
    loadUploads(clientId);
  }

  const uniqU = (f: (u: UploadRow) => string | number | undefined | null) =>
    Array.from(new Set(uploads.map(f).filter((v) => v != null && v !== "") as string[])).sort();
  const fYears  = Array.from(new Set(uploads.map((u) => u.meta?.year).filter(Boolean) as number[])).sort((a, b) => b - a).map(String);
  const fMonths = uniqU((u) => u.meta?.bulan);
  const fWeeks  = uniqU((u) => u.meta?.week);
  const fOwners = uniqU((u) => u.meta?.pic_client);
  const fStores = flt.owner
    ? uniqU((u) => u.meta?.pic_client === flt.owner ? u.meta?.store_name : null)
    : uniqU((u) => u.meta?.store_name);

  const shownUploads = uploads.filter((u) =>
    (!flt.year   || String(u.meta?.year) === flt.year) &&
    (!flt.month  || u.meta?.bulan === flt.month) &&
    (!flt.week   || u.meta?.week === flt.week) &&
    (!flt.owner  || u.meta?.pic_client === flt.owner) &&
    (!flt.store  || u.meta?.store_name === flt.store) &&
    (!flt.category || categoryOf(u.source) === flt.category)
  );

  // Group into the 4 requested buckets — Store Performance (perf+spos),
  // Ads Performance (ads+ads_group), Order Complete, Finance Detail —
  // keyed by category+store+period, NOT by upload timestamp. An earlier
  // version grouped by "same upload minute", which looked right for a
  // single click but split Store Performa from Product Performa apart
  // whenever the two sequential POSTs happened to cross a minute boundary.
  // Category+period is what the user actually means by "1 log": these
  // files always belong together for that store's period, regardless of
  // exactly when each one finished uploading.
  type UploadGroup = {
    key: string; ids: string[]; created_at: string; category: Category;
    bulan?: string; week?: string; year?: number; admin?: string; pic_client?: string; store_name?: string;
    files: { source: UploadSource; filename: string | null; ads_level?: string }[];
  };
  const shownGroups: UploadGroup[] = (() => {
    const map = new Map<string, UploadGroup>();
    for (const u of shownUploads) {
      const category = categoryOf(u.source);
      const key = [category, u.meta?.store_name, u.meta?.bulan, u.meta?.week, u.meta?.year].join("|");
      let g = map.get(key);
      if (!g) {
        g = { key, ids: [], created_at: u.created_at, category, bulan: u.meta?.bulan, week: u.meta?.week, year: u.meta?.year, admin: u.meta?.admin, pic_client: u.meta?.pic_client, store_name: u.meta?.store_name, files: [] };
        map.set(key, g);
      }
      g.ids.push(u.id);
      g.files.push({ source: u.source, filename: u.filename, ads_level: u.meta?.ads_level });
      // Show the most recent file's timestamp — with category+period
      // grouping (no time-window limit), a group can span multiple upload
      // sessions on different days, so "latest touched" is more useful
      // than "first ever uploaded".
      if (new Date(u.created_at) > new Date(g.created_at)) g.created_at = u.created_at;
    }
    for (const g of map.values()) g.files.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
    return [...map.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  })();

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>Upload Log</h3>
          <div className="hint">Filter by period or store — delete a bad upload to remove all its rows.</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "3px 12px" }}>
          {shownGroups.length} upload{shownGroups.length === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 10 }}>
        <Field label="Year">
          <select value={flt.year} onChange={(e) => setFlt((f) => ({ ...f, year: e.target.value }))}>
            <option value="">All years</option>
            {fYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <Field label="Month">
          <select value={flt.month} onChange={(e) => setFlt((f) => ({ ...f, month: e.target.value }))}>
            <option value="">All months</option>
            {fMonths.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Week">
          <select value={flt.week} onChange={(e) => setFlt((f) => ({ ...f, week: e.target.value }))}>
            <option value="">All weeks</option>
            {fWeeks.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr) auto", gap: 10, marginBottom: 14, alignItems: "end" }}>
        <Field label="Owner">
          <select value={flt.owner} onChange={(e) => setFlt((f) => ({ ...f, owner: e.target.value, store: "" }))}>
            <option value="">All owners</option>
            {fOwners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Store">
          <select value={flt.store} onChange={(e) => setFlt((f) => ({ ...f, store: e.target.value }))}>
            <option value="">All stores</option>
            {fStores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={flt.category} onChange={(e) => setFlt((f) => ({ ...f, category: e.target.value }))}>
            <option value="">All types</option>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
        <button className="btn-ghost" onClick={() => setFlt({ year: "", month: "", week: "", owner: "", store: "", category: "" })} style={{ height: 38 }}>Reset</button>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Time Upload</th><th>Type</th><th>Month</th><th>Week</th><th>Admin</th>
              <th>File</th><th>Tipe</th><th>Owner</th><th>Store</th><th></th>
            </tr>
          </thead>
          <tbody>
            {shownGroups.map((g) => (
              <tr key={g.key}>
                <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{fmtUploadTime(g.created_at)}</td>
                <td style={{ fontSize: 12, color: "#cdd9f0" }}>{CATEGORY_LABEL[g.category]}</td>
                <td>{g.bulan || "—"}</td>
                <td>{g.week || "—"}</td>
                <td>{g.admin || "—"}</td>
                <td>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {g.files.map((f, i) => (
                      <span key={i} style={{ fontSize: 11.5, color: "var(--muted)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.filename || ""}>
                        {f.filename || "—"}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {g.files.map((f, i) => {
                      const label = f.source === "ads_group"
                        ? (f.ads_level === "incubation" ? "Inkubasi" : f.ads_level === "hero" ? "Hero" : f.ads_level === "low_conversion" ? "Low Conv." : "Group")
                        : SRC_LABEL[f.source];
                      return (
                        <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: SRC_COLOR[f.source] + "22", color: SRC_COLOR[f.source], border: `1px solid ${SRC_COLOR[f.source]}44` }}>
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td>{g.pic_client || "—"}</td>
                <td style={{ fontWeight: 700, color: "#fff" }}>{g.store_name || "—"}</td>
                <td><button onClick={() => delUploads(g.ids)} style={delBtnStyle}>Delete</button></td>
              </tr>
            ))}
            {shownGroups.length === 0 && (
              <tr><td colSpan={10} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>
                {uploads.length ? "No uploads match these filters" : "No uploads yet"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const delBtnStyle: React.CSSProperties = { background: "rgba(255,80,80,.12)", border: "1px solid rgba(255,90,90,.3)", color: "#ff9a9a", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontSize: 12 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}
