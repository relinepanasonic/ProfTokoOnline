"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataSource } from "@/lib/parse";

export const dynamic = "force-dynamic";

const SLOTS: { source: DataSource; label: string; hint: string; accept: string }[] = [
  { source: "perf", label: "Performa", hint: "sales_overview", accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "SPOS", hint: "parentskudetail", accept: ".xlsx,.xls,.csv" },
  { source: "ads", label: "Ads", hint: "Data Keseluruhan Iklan", accept: ".xlsx,.xls,.csv" },
];

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
const BASELINE_WEEK = "Baseline (Week 0)";
const SRC_LABEL: Record<string, string> = { perf: "Performa", spos: "SPOS", ads: "Ads" };
const SRC_COLOR: Record<string, string> = { perf: "#22c55e", spos: "#3b82f6", ads: "#f59e0b" };

function toISODate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function mondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return toISODate(d);
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function fmtID(iso: string): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
}

type UploadRow = {
  id: string; source: DataSource; filename: string | null; row_count: number; created_at: string;
  meta: { pic_client?: string; store_name?: string; bulan?: string; week?: string; year?: number; admin?: string } | null;
};

export default function UploadPage() {
  const [supabase] = useState(() => createClient());
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [manual, setManual] = useState({
    bulan: "", year: new Date().getFullYear(), week: "Week 1",
    pic_client: "", brand: "", store_name: "",
    tanggal_mulai: "", tanggal_berakhir: "",
  });
  const inputTime = new Date();
  const [adminName, setAdminName] = useState("");
  const [clientId, setClientId] = useState("");

  const [owners, setOwners] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [links, setLinks] = useState<{ owner: string | null; brand: string | null; store_name: string | null }[]>([]);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [flt, setFlt] = useState({ year: "", month: "", week: "", owner: "", store: "", source: "" });

  // ---------- cascade handlers ----------
  function pickBulan(v: string) {
    if (v === "Baseline") {
      setManual((m) => ({ ...m, bulan: v, week: BASELINE_WEEK, tanggal_mulai: "", tanggal_berakhir: "" }));
    } else {
      setManual((m) => ({ ...m, bulan: v, week: m.week === BASELINE_WEEK ? "Week 1" : m.week }));
    }
  }
  function pickOwner(owner: string) { setManual((m) => ({ ...m, pic_client: owner, brand: "", store_name: "" })); }
  function pickBrand(brand: string) { setManual((m) => ({ ...m, brand, store_name: "" })); }
  function pickStore(storeName: string) { setManual((m) => ({ ...m, store_name: storeName })); }
  function pickStart(v: string) {
    if (!v) { setManual((m) => ({ ...m, tanggal_mulai: "", tanggal_berakhir: "" })); return; }
    const mon = mondayOf(v);
    setManual((m) => ({ ...m, tanggal_mulai: mon, tanggal_berakhir: addDays(mon, 6) }));
  }

  // Derived cascaded option lists
  const brandsForOwner = manual.pic_client
    ? Array.from(new Set(links.filter((l) => l.owner === manual.pic_client).map((l) => l.brand).filter(Boolean) as string[])).sort()
    : Array.from(new Set(links.map((l) => l.brand).filter(Boolean) as string[])).sort();
  const storesForBrand = manual.brand
    ? links.filter((l) => l.brand === manual.brand && (!manual.pic_client || l.owner === manual.pic_client)).map((l) => l.store_name).filter(Boolean) as string[]
    : manual.pic_client
      ? links.filter((l) => l.owner === manual.pic_client).map((l) => l.store_name).filter(Boolean) as string[]
      : stores;

  // ---------- data loading ----------
  const loadUploads = useCallback(async (cid: string) => {
    if (!cid) { setUploads([]); return; }
    const { data } = await supabase.from("uploads")
      .select("id,source,filename,row_count,created_at,meta")
      .eq("client_id", cid)
      .order("created_at", { ascending: false });
    setUploads((data as UploadRow[]) || []);
  }, [supabase]);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setOwners([]); setStores([]); setLinks([]); return; }
    const { data: sl } = await supabase.from("store_links")
      .select("owner,brand,store_name").eq("client_id", cid).order("created_at");
    const linkData = (sl as { owner: string | null; brand: string | null; store_name: string | null }[]) || [];
    setLinks(linkData);
    const uniq = (xs: (string | null)[]) => Array.from(new Set(xs.filter(Boolean) as string[])).sort();
    setOwners(uniq(linkData.map((l) => l.owner)));
    setStores(uniq(linkData.map((l) => l.store_name)));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: p }, { data: cs }] = await Promise.all([
        supabase.from("profiles").select("display_name,email").eq("id", user.id).single(),
        supabase.from("clients").select("id").order("created_at").limit(1),
      ]);
      const name = (p as { display_name: string | null; email: string | null } | null)?.display_name
        || user.email?.split("@")[0] || "Admin";
      setAdminName(name);
      const first = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(first);
      reload(first);
      loadUploads(first);
    })();
  }, [supabase, reload, loadUploads]);

  async function delUpload(id: string) {
    if (!confirm("Delete this upload and all its rows? This cannot be undone.")) return;
    const { error } = await supabase.from("uploads").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    // Rebuild the dashboard rollup so the deleted rows drop out immediately
    // (otherwise they'd linger until the hourly pg_cron refresh — migration 0052).
    await supabase.rpc("refresh_dashboard_rollup");
    loadUploads(clientId);
  }

  async function submit() {
    setBusy(true); setLog([]);
    if (!clientId) { setLog(["Workspace not ready."]); setBusy(false); return; }
    const chosen = SLOTS.filter((s) => files[s.source]);
    if (!chosen.length) { setLog(["Pick at least one file."]); setBusy(false); return; }
    const manualToSend = { ...manual, admin: adminName, tanggal_input: new Date().toISOString() };
    for (const slot of chosen) {
      const fd = new FormData();
      fd.append("file", files[slot.source]!);
      fd.append("source", slot.source);
      fd.append("manual", JSON.stringify(manualToSend));
      fd.append("client_id", clientId);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const j = await res.json();
        setLog((l) => [...l, res.ok ? `✓ ${slot.label}: ${j.rows} rows` : `✗ ${slot.label}: ${j.error}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${slot.label}: ${String(e)}`]);
      }
    }
    setBusy(false);
    loadUploads(clientId);
  }

  // ---------- derived filter options ----------
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
    (!flt.source || u.source === flt.source)
  );

  // ---------- data per store summary ----------
  const storeStats = (() => {
    const map = new Map<string, { owner: string; rows: number; sources: Set<string>; periods: Set<string> }>();
    for (const u of uploads) {
      const key = u.meta?.store_name || "—";
      if (!map.has(key)) map.set(key, { owner: u.meta?.pic_client || "—", rows: 0, sources: new Set(), periods: new Set() });
      const s = map.get(key)!;
      s.rows += u.row_count || 0;
      s.sources.add(u.source);
      if (u.meta?.bulan) s.periods.add(`${u.meta.bulan}${u.meta.year ? " " + u.meta.year : ""}`);
    }
    return [...map.values()].map((s, i) => ({ ...s, store: [...map.keys()][i] })).sort((a, b) => b.rows - a.rows);
  })();

  const isBaseline = manual.bulan === "Baseline";

  return (
    <>
      {/* ───── Upload form ───── */}
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Upload Shopee Data</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <a
              href="/Manual%20Book%203%20Core%20Report%20Download.pdf"
              download="Manual Book 3 Core Report Download.pdf"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--navy-deep)", background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", borderRadius: 999, padding: "7px 16px", textDecoration: "none" }}
            >
              ⬇ Download Cara Tarik Data dari Shopee
            </a>
            {adminName && (
              <span style={{ fontSize: 12, color: "var(--gold)", background: "rgba(201,162,39,.1)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "3px 12px", fontWeight: 700 }}>
                by {adminName}
              </span>
            )}
          </div>
        </div>
        <div className="hint" style={{ marginBottom: 16 }}>Attach one or more Shopee exports — Brand comes from your Owner → Brand → Store selection above.</div>

        {/* Row 1: Year · Month · Week */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label="Year">
            <input type="number" value={manual.year} onChange={(e) => setManual((m) => ({ ...m, year: Number(e.target.value) }))} />
          </Field>
          <Field label="Bulan">
            <select value={manual.bulan} onChange={(e) => pickBulan(e.target.value)}>
              <option value="">Month</option>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
              <option value="Baseline">📌 Baseline (Month Awal)</option>
            </select>
          </Field>
          <Field label="Week">
            <select value={manual.week} onChange={(e) => setManual((m) => ({ ...m, week: e.target.value }))}>
              {WEEKS.map((w) => <option key={w}>{w}</option>)}
              <option value={BASELINE_WEEK}>📌 {BASELINE_WEEK}</option>
            </select>
          </Field>
        </div>

        {/* Row 2: Owner · Brand · Store Name (cascading) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label="Owner">
            <select value={manual.pic_client} onChange={(e) => pickOwner(e.target.value)} disabled={!clientId}>
              <option value="">Select owner…</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Brand">
            <select value={manual.brand} onChange={(e) => pickBrand(e.target.value)} disabled={!manual.pic_client}>
              <option value="">{manual.pic_client ? "Select brand…" : "Pick owner first"}</option>
              {brandsForOwner.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Store Name">
            <select value={manual.store_name} onChange={(e) => pickStore(e.target.value)} disabled={!manual.brand}>
              <option value="">{manual.brand ? "Select store…" : "Pick brand first"}</option>
              {storesForBrand.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        {/* Row 3: 3 dates */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
          <Field label="Tanggal Mulai (Senin)">
            {isBaseline ? <BaselineDateBadge /> : <>
              <input type="date" value={manual.tanggal_mulai} onChange={(e) => pickStart(e.target.value)} />
              <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>Auto-snaps to Monday · {fmtID(manual.tanggal_mulai)}</span>
            </>}
          </Field>
          <Field label="Tanggal Akhir (Minggu)">
            {isBaseline ? <BaselineDateBadge /> : <>
              <input type="date" value={manual.tanggal_berakhir} readOnly disabled style={{ opacity: .7, cursor: "not-allowed" }} />
              <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>1 week after start · {fmtID(manual.tanggal_berakhir)}</span>
            </>}
          </Field>
          <Field label="Tanggal Input (log)">
            <input type="text" value={inputTime.toLocaleString("id-ID")} readOnly disabled style={{ opacity: .7, cursor: "not-allowed" }} />
            <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>Recorded automatically</span>
          </Field>
        </div>

        {/* File pickers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 14 }}>
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

        <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
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

      {/* ───── Data per Store summary ───── */}
      {storeStats.length > 0 && (
        <div className="panel" style={{ marginTop: 18 }}>
          <h3 style={{ margin: "0 0 4px" }}>Data per Store</h3>
          <div className="hint">Total rows uploaded per store across all sources and periods.</div>
          <div className="tbl-wrap" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Store</th><th>Owner</th><th>Total Rows</th>
                  <th>Sources</th><th>Months</th>
                </tr>
              </thead>
              <tbody>
                {storeStats.map((s) => (
                  <tr key={s.store}>
                    <td style={{ fontWeight: 600 }}>{s.store}</td>
                    <td>{s.owner}</td>
                    <td className="num">{s.rows.toLocaleString("id-ID")}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {[...s.sources].map((src) => (
                          <span key={src} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: SRC_COLOR[src] + "22", color: SRC_COLOR[src], border: `1px solid ${SRC_COLOR[src]}44` }}>
                            {SRC_LABEL[src] || src}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{[...s.periods].slice(0, 4).join(", ")}{s.periods.size > 4 ? ` +${s.periods.size - 4}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── Upload Log ───── */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Upload Log</h3>
            <div className="hint">Filter by period or store — delete a bad upload to remove all its rows.</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "3px 12px" }}>
            {shownUploads.length} / {uploads.length}
          </span>
        </div>

        {/* 6-filter bar */}
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
          <Field label="Source">
            <select value={flt.source} onChange={(e) => setFlt((f) => ({ ...f, source: e.target.value }))}>
              <option value="">All sources</option>
              {SLOTS.map((s) => <option key={s.source} value={s.source}>{s.label}</option>)}
            </select>
          </Field>
          <button className="btn-ghost" onClick={() => setFlt({ year: "", month: "", week: "", owner: "", store: "", source: "" })} style={{ height: 38 }}>Reset</button>
        </div>

        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Owner</th><th>Store</th><th>Source</th>
                <th>Month</th><th>Week</th><th>Year</th>
                <th className="num">Rows</th><th>File</th><th>Uploaded</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shownUploads.map((u) => (
                <tr key={u.id}>
                  <td>{u.meta?.pic_client || "—"}</td>
                  <td>{u.meta?.store_name || "—"}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: SRC_COLOR[u.source] + "22", color: SRC_COLOR[u.source], border: `1px solid ${SRC_COLOR[u.source]}44` }}>
                      {SRC_LABEL[u.source] || u.source}
                    </span>
                  </td>
                  <td>{u.meta?.bulan || "—"}</td>
                  <td>{u.meta?.week || "—"}</td>
                  <td>{u.meta?.year || "—"}</td>
                  <td className="num">{u.row_count?.toLocaleString("id-ID") || 0}</td>
                  <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.filename || ""}>{u.filename || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString("id-ID")}</td>
                  <td><button onClick={() => delUpload(u.id)} style={delBtnStyle}>Delete</button></td>
                </tr>
              ))}
              {shownUploads.length === 0 && (
                <tr><td colSpan={10} style={{ color: "var(--muted)", textAlign: "center", padding: 20 }}>
                  {uploads.length ? "No uploads match these filters" : "No uploads yet"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
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

function BaselineDateBadge() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderRadius: 10, border: "1px solid rgba(201,162,39,.35)", background: "rgba(201,162,39,.08)", color: "var(--gold)", fontWeight: 700, fontSize: 13, fontStyle: "italic", minHeight: 38 }}>
      📌 Month Awal
    </div>
  );
}
