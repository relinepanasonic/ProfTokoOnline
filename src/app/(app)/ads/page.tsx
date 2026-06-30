"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/* ── types ── */
type AdRow = {
  upload_id: string | null;
  year: number | null; month: string | null; week: string | null;
  store_name: string | null; pic_client: string | null; brand: string | null;
  grup_iklan: string | null; ads_level: string | null; level: string;
  item_name: string | null; kode_produk: string | null;
  biaya: number | null; omzet: number | null;
};
type ModalRow = { store_name: string; grup_iklan: string; year: number; month: string; week: string; modal_harian: number | null };
type Link = { owner: string | null; brand: string | null; store_name: string | null };
type Mode = "week" | "month";

/* ── constants ── */
const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const MONTH_ORDER = ["Baseline", ...MONTHS];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const LEVELS = [
  { v: "incubation",     l: "Incubation",     c: "#3b82f6" },
  { v: "hero",           l: "Hero",           c: "#c9a227" },
  { v: "regular",        l: "Regular",        c: "#8b5cf6" },
  { v: "low_conversion", l: "Low Conversion", c: "#ef4444" },
];
const levelMeta = (v: string | null) => LEVELS.find((x) => x.v === v);

/* number formatting (all values rendered WHITE) */
function rpC(n: number): string {
  const v = n || 0, a = Math.abs(v);
  if (a >= 1e9) return "Rp " + (v / 1e9).toFixed(1) + "M";
  if (a >= 1e6) return "Rp " + (v / 1e6).toFixed(1) + "jt";
  if (a >= 1e3) return "Rp " + Math.round(v / 1e3) + "rb";
  return "Rp " + Math.round(v);
}
const rpFull = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const roasF  = (n: number) => (n || 0).toFixed(2) + "×";

/* aggregate { biaya, gmv } from a set of rows */
type Agg = { biaya: number; gmv: number };
function sumAgg(rows: AdRow[]): Agg {
  const a: Agg = { biaya: 0, gmv: 0 };
  for (const r of rows) { a.biaya += r.biaya ?? 0; a.gmv += r.omzet ?? 0; }
  return a;
}
const roasOf = (a: Agg) => (a.biaya ? a.gmv / a.biaya : 0);

/* ════════════════════════════════════════════════════════════════════ */
export default function AdsPerformancePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [role, setRole] = useState("");
  const [tab, setTab] = useState<"performance" | "formulation">("performance");

  const [rows, setRows] = useState<AdRow[]>([]);
  const [modals, setModals] = useState<ModalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cid: string) => {
    setLoading(true);
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.from("ad_groups")
        .select("upload_id,year,month,week,store_name,pic_client,brand,grup_iklan,ads_level,level,item_name,kode_produk,biaya,omzet")
        .eq("client_id", cid),
      supabase.from("ad_modals").select("store_name,grup_iklan,year,month,week,modal_harian").eq("client_id", cid),
    ]);
    setRows((r as AdRow[]) || []);
    setModals((m as ModalRow[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole((p as { role: string } | null)?.role || "");
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(cid);
      if (cid) load(cid);
    })();
  }, [supabase, load]);

  const canUpload = ["superadmin", "client_admin", "advertiser"].includes(role);
  const canDelete = ["superadmin", "advertiser"].includes(role);

  return (
    <>
      {/* tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["performance", "formulation"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
            {t === "performance" ? "Performance" : "Formulation"}
          </button>
        ))}
      </div>

      {tab === "performance" ? (
        <PerformanceTab
          rows={rows} modals={modals} loading={loading} clientId={clientId}
          supabase={supabase} canUpload={canUpload} canDelete={canDelete}
          reload={() => load(clientId)}
        />
      ) : (
        <FormulationTab rows={rows} />
      )}
    </>
  );
}

/* ════════════════ Performance tab ════════════════ */
function PerformanceTab({ rows, modals, loading, clientId, supabase, canUpload, canDelete, reload }: {
  rows: AdRow[]; modals: ModalRow[]; loading: boolean; clientId: string;
  supabase: ReturnType<typeof createClient>; canUpload: boolean; canDelete: boolean; reload: () => void;
}) {
  const [mode, setMode] = useState<Mode>("week");
  const [fYear, setFYear] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fLevel, setFLevel] = useState("");
  const [fStore, setFStore] = useState("");
  const [fGrup, setFGrup] = useState("");
  const [drill, setDrill] = useState<{ store: string; grup: string } | null>(null);

  /* option lists */
  const years  = useMemo(() => Array.from(new Set(rows.map((r) => r.year).filter(Boolean) as number[])).sort((a,b)=>b-a), [rows]);
  const months = useMemo(() => Array.from(new Set(rows.map((r) => r.month).filter(Boolean) as string[])).sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b)), [rows]);
  const stores = useMemo(() => Array.from(new Set(rows.map((r) => r.store_name).filter(Boolean) as string[])).sort(), [rows]);
  const grups  = useMemo(() => Array.from(new Set(rows.map((r) => r.grup_iklan).filter(Boolean) as string[])).sort(), [rows]);

  // default month to the latest available (week mode needs a month context)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!fMonth && months.length) setFMonth(months[months.length - 1]); }, [months, fMonth]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!fYear && years.length) setFYear(String(years[0])); }, [years, fYear]);

  /* scoped group-level rows */
  const scoped = useMemo(() => rows.filter((r) =>
    r.level === "group" &&
    (!fYear  || String(r.year) === fYear) &&
    (!fLevel || r.ads_level === fLevel) &&
    (!fStore || r.store_name === fStore) &&
    (!fGrup  || r.grup_iklan === fGrup) &&
    (mode === "month" || !fMonth || r.month === fMonth)
  ), [rows, fYear, fLevel, fStore, fGrup, fMonth, mode]);

  /* period columns */
  const periods = useMemo(() => {
    if (mode === "week") {
      const present = new Set(scoped.map((r) => r.week).filter(Boolean) as string[]);
      return WEEKS.filter((w) => present.has(w));
    }
    return Array.from(new Set(scoped.map((r) => r.month).filter(Boolean) as string[])).sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b));
  }, [scoped, mode]);
  const periodKey = useCallback((r: AdRow) => (mode === "week" ? r.week : r.month) || "", [mode]);

  /* group rows: one per (store, grup) */
  const groupRows = useMemo(() => {
    const map = new Map<string, { store: string; grup: string; level: string | null }>();
    for (const r of scoped) {
      const k = `${r.store_name}|||${r.grup_iklan}`;
      if (!map.has(k)) map.set(k, { store: r.store_name || "—", grup: r.grup_iklan || "—", level: r.ads_level });
    }
    return Array.from(map.values()).sort((a, b) => a.store.localeCompare(b.store) || a.grup.localeCompare(b.grup));
  }, [scoped]);

  const cellAgg = useCallback((store: string, grup: string, period: string): Agg =>
    sumAgg(scoped.filter((r) => r.store_name === store && r.grup_iklan === grup && periodKey(r) === period)),
  [scoped, periodKey]);
  const rowTotal = useCallback((store: string, grup: string): Agg =>
    sumAgg(scoped.filter((r) => r.store_name === store && r.grup_iklan === grup)),
  [scoped]);

  const grand = useMemo(() => {
    const per = new Map<string, Agg>();
    for (const p of periods) per.set(p, sumAgg(scoped.filter((r) => periodKey(r) === p)));
    return { per, total: sumAgg(scoped) };
  }, [scoped, periods, periodKey]);

  /* modal lookup + edit */
  const modalKey = (s: string, g: string, w: string) => `${s}|||${g}|||${fYear}|||${fMonth}|||${w}`;
  const modalMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const x of modals) m.set(`${x.store_name}|||${x.grup_iklan}|||${x.year}|||${x.month}|||${x.week}`, x.modal_harian);
    return m;
  }, [modals]);
  async function saveModal(store: string, grup: string, week: string, val: string) {
    const num = val === "" ? null : Number(val.replace(/[^0-9]/g, ""));
    await supabase.from("ad_modals").upsert({
      client_id: clientId, store_name: store, grup_iklan: grup,
      year: Number(fYear), month: fMonth, week, modal_harian: num, updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,store_name,grup_iklan,year,month,week" });
    reload();
  }

  async function deleteGroup(store: string, grup: string) {
    if (!confirm(`Delete all uploaded data for "${grup}" @ ${store} in the current scope?`)) return;
    const ids = Array.from(new Set(rows.filter((r) =>
      r.store_name === store && r.grup_iklan === grup &&
      (!fYear || String(r.year) === fYear) &&
      (mode === "month" || !fMonth || r.month === fMonth)
    ).map((r) => r.upload_id).filter(Boolean) as string[]));
    if (ids.length) await supabase.from("uploads").delete().in("id", ids);
    reload();
  }

  return (
    <>
      {canUpload && (
        <UploadIklan clientId={clientId} supabase={supabase} onUploaded={reload} />
      )}

      <div className="panel" style={{ marginTop: 18 }}>
        {/* header + mode toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>Grup Iklan Performance</h3>
            <div className="hint">Click a row to drill down ↗ · Trash 🗑 to delete data for that group</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["week", "month"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} style={tabBtn(mode === m)}>
                {m === "week" ? "Week vs Week" : "Month vs Month"}
              </button>
            ))}
          </div>
        </div>

        {/* filters */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr) auto auto", gap: 10, alignItems: "end", marginBottom: 14 }}>
          <div className="fld"><label>Year</label>
            <select value={fYear} onChange={(e) => setFYear(e.target.value)}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div className="fld"><label>Month</label>
            <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} disabled={mode === "month"}>
              <option value="">{mode === "month" ? "—" : "All months"}</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="fld"><label>Level</label>
            <select value={fLevel} onChange={(e) => setFLevel(e.target.value)}>
              <option value="">All Levels</option>
              {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
            </select>
          </div>
          <div className="fld"><label>Dealer</label>
            <select value={fStore} onChange={(e) => setFStore(e.target.value)}>
              <option value="">All Dealers</option>
              {stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld"><label>Grup Iklan</label>
            <select value={fGrup} onChange={(e) => setFGrup(e.target.value)}>
              <option value="">All Groups</option>
              {grups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <button className="btn-ghost" onClick={() => { setFLevel(""); setFStore(""); setFGrup(""); }} style={{ height: 38 }}>Reset</button>
          <span style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{groupRows.length} groups</span>
        </div>

        {/* table */}
        <div className="tbl-wrap">
          <table className="tbl" style={{ color: "#e8edf8" }}>
            <thead>
              <tr>
                <th>Dealer</th><th>Grup Iklan</th>
                {periods.map((p) => <th key={p} className="num">{p}</th>)}
                <th className="num">Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {groupRows.map((g) => {
                const tot = rowTotal(g.store, g.grup);
                const lm = levelMeta(g.level);
                return (
                  <tr key={`${g.store}|${g.grup}`} style={{ cursor: "pointer" }} onClick={() => setDrill({ store: g.store, grup: g.grup })}>
                    <td style={{ fontWeight: 600 }}>{g.store}</td>
                    <td>
                      {g.grup}{" "}
                      {lm && <span style={badge(lm.c)}>{lm.l}</span>}
                    </td>
                    {periods.map((p) => {
                      const a = cellAgg(g.store, g.grup, p);
                      return (
                        <td key={p} className="num">
                          <Cell a={a} />
                          {mode === "week" && (
                            <input
                              defaultValue={modalMap.get(modalKey(g.store, g.grup, p)) ?? ""}
                              onClick={(e) => e.stopPropagation()}
                              onBlur={(e) => saveModal(g.store, g.grup, p, e.target.value)}
                              placeholder="Modal/hari"
                              style={modalInput}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="num"><Cell a={tot} bold /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ color: "#9ab0cc" }}>↗</span>
                        {canDelete && <button onClick={() => deleteGroup(g.store, g.grup)} style={trashBtn} title="Delete data">🗑</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {groupRows.length === 0 && (
                <tr><td colSpan={periods.length + 4} style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>
                  {loading ? "Loading…" : rows.length ? "No groups match these filters" : "No Grup Iklan uploaded yet — use the upload box above."}
                </td></tr>
              )}
              {groupRows.length > 0 && (
                <tr style={{ borderTop: "2px solid var(--line)" }}>
                  <td style={{ fontWeight: 800 }}>TOTAL</td><td></td>
                  {periods.map((p) => <td key={p} className="num"><Cell a={grand.per.get(p) || { biaya:0, gmv:0 }} bold /></td>)}
                  <td className="num">
                    <div style={{ fontWeight: 800 }}>{rpFull(grand.total.biaya)}</div>
                    <div style={{ fontSize: 12 }}>{rpFull(grand.total.gmv)}</div>
                    <div style={{ fontSize: 12 }}>{roasF(roasOf(grand.total))}</div>
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* legend */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 11.5, color: "var(--muted)" }}>
          <span>▪ Biaya · GMV · ROAS</span>
          {LEVELS.map((l) => <span key={l.v} style={{ color: l.c }}>● {l.l}</span>)}
          <span>· Modal/hari editable in Week view · 🗑 deletes visible scope</span>
        </div>
      </div>

      {drill && (
        <DrillDown
          store={drill.store} grup={drill.grup} mode={mode} periods={periods}
          rows={rows.filter((r) => r.store_name === drill.store && r.grup_iklan === drill.grup &&
            (!fYear || String(r.year) === fYear) && (mode === "month" || !fMonth || r.month === fMonth) && (!fLevel || r.ads_level === fLevel))}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

/* a Biaya/GMV/ROAS cell (all white) */
function Cell({ a, bold }: { a: Agg; bold?: boolean }) {
  if (!a.biaya && !a.gmv) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div style={{ lineHeight: 1.35 }}>
      <div style={{ fontWeight: bold ? 800 : 600 }}>{rpC(a.biaya)}</div>
      <div style={{ fontSize: 12.5 }}>{rpC(a.gmv)}</div>
      <div style={{ fontSize: 12, color: "#cdd9f0" }}>{roasF(roasOf(a))}</div>
    </div>
  );
}

/* ════════════════ Drill-down overlay ════════════════ */
function DrillDown({ store, grup, mode, periods, rows, onClose }: {
  store: string; grup: string; mode: Mode; periods: string[]; rows: AdRow[]; onClose: () => void;
}) {
  const periodKey = (r: AdRow) => (mode === "week" ? r.week : r.month) || "";
  const products = useMemo(() => {
    const map = new Map<string, { kode: string; name: string }>();
    for (const r of rows.filter((x) => x.level === "product")) {
      const k = r.item_name || "";
      if (!map.has(k)) map.set(k, { kode: r.kode_produk || "—", name: r.item_name || "—" });
    }
    return Array.from(map.values());
  }, [rows]);

  const groupRows = rows.filter((r) => r.level === "group");
  const grupTotalPer = (p: string) => sumAgg(groupRows.filter((r) => periodKey(r) === p));
  const grupTotal = sumAgg(groupRows);
  const prodPer = (name: string, p: string) => sumAgg(rows.filter((r) => r.level === "product" && r.item_name === name && periodKey(r) === p));
  const prodTotal = (name: string) => sumAgg(rows.filter((r) => r.level === "product" && r.item_name === name));
  const lm = levelMeta(rows[0]?.ads_level ?? null);

  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={drawer} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
              {store} {lm && <span style={badge(lm.c)}>{lm.l}</span>}
            </div>
            <div style={{ color: "#9ab0cc", marginTop: 4 }}>Grup Iklan: <b style={{ color: "#e8edf8" }}>{grup}</b></div>
          </div>
          <button className="btn-ghost" onClick={onClose}>✕ Close</button>
        </div>

        {/* grup total summary */}
        <div style={{ display: "grid", gridTemplateColumns: `200px repeat(${periods.length},1fr) 1fr`, gap: 1, background: "var(--line)", borderRadius: 12, overflow: "hidden", marginBottom: 18 }}>
          <div style={sumCell}>
            <div style={{ fontSize: 10.5, color: "#7b8db0", textTransform: "uppercase" }}>Grup Iklan Total</div>
            <div style={{ fontWeight: 700, color: "#fff", marginTop: 4 }}>{grup}</div>
          </div>
          {periods.map((p) => { const a = grupTotalPer(p); return (
            <div key={p} style={sumCell}>
              <div style={{ fontSize: 10.5, color: "#7b8db0" }}>{p}</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 4 }}>{rpC(a.biaya)}</div>
              <div style={{ fontSize: 12.5, color: "#e8edf8" }}>{rpC(a.gmv)}</div>
              <div style={{ fontSize: 12, color: "#cdd9f0" }}>{roasF(roasOf(a))}</div>
            </div>
          ); })}
          <div style={sumCell}>
            <div style={{ fontSize: 10.5, color: "#7b8db0" }}>Total</div>
            <div style={{ color: "#fff", fontWeight: 700, marginTop: 4 }}>{rpC(grupTotal.biaya)}</div>
            <div style={{ fontSize: 12.5, color: "#e8edf8" }}>{rpC(grupTotal.gmv)}</div>
            <div style={{ fontSize: 12, color: "#cdd9f0" }}>{roasF(roasOf(grupTotal))}</div>
          </div>
        </div>

        {/* product table */}
        <div className="tbl-wrap" style={{ maxHeight: "55vh" }}>
          <table className="tbl" style={{ color: "#e8edf8" }}>
            <thead>
              <tr>
                <th>Kode Produk</th><th>Nama Iklan / Produk</th>
                <th className="num">Analisa</th>
                {periods.map((p) => <th key={p} className="num">{p}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {products.map((pr) => (
                <tr key={pr.name}>
                  <td style={{ color: "#9ab0cc", fontSize: 12 }}>{pr.kode}</td>
                  <td style={{ maxWidth: 260, fontSize: 12.5 }}>{pr.name}</td>
                  {/* Analisa — formula to be supplied later */}
                  <td className="num" style={{ color: "var(--muted)" }}>—</td>
                  {periods.map((p) => <td key={p} className="num"><Cell a={prodPer(pr.name, p)} /></td>)}
                  <td className="num"><Cell a={prodTotal(pr.name)} bold /></td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={periods.length + 4} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>No product rows</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ════════════════ Formulation tab ════════════════ */
function FormulationTab({ rows }: { rows: AdRow[] }) {
  const years  = useMemo(() => Array.from(new Set(rows.map((r) => r.year).filter(Boolean) as number[])).sort((a,b)=>b-a), [rows]);
  const months = useMemo(() => Array.from(new Set(rows.map((r) => r.month).filter(Boolean) as string[])).sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b)), [rows]);
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!year && years.length) setYear(String(years[0])); }, [years, year]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!month && months.length) setMonth(months[months.length - 1]); }, [months, month]);

  const scope = useMemo(() => rows.filter((r) => r.level === "group" && (!year || String(r.year) === year) && (!month || r.month === month)), [rows, year, month]);
  const overall = sumAgg(scope);
  const monthlyAvgRoas = roasOf(overall);

  const perLevel = LEVELS.map((l) => {
    const a = sumAgg(scope.filter((r) => r.ads_level === l.v));
    return { ...l, spent: a.biaya, roas: roasOf(a) };
  });

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Formulation</h3>
          <div className="hint">Monthly ROAS by ad level · spend &amp; ROAS computed from uploaded Grup Iklan data</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="fld" style={{ minWidth: 110 }}><label>Year</label>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div className="fld" style={{ minWidth: 130 }}><label>Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Monthly AVG ROAS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 18 }}>
        <StatCard label="Monthly AVG ROAS" value={roasF(monthlyAvgRoas)} sub={`${month || "—"} ${year || ""}`} accent />
        <StatCard label="Total Ads Spent" value={rpFull(overall.biaya)} sub="all levels" />
        <StatCard label="Total GMV" value={rpFull(overall.gmv)} sub="all levels" />
      </div>

      {/* per-level table */}
      <div className="tbl-wrap">
        <table className="tbl" style={{ color: "#e8edf8" }}>
          <thead><tr><th>Ads Level</th><th className="num">Ads Spent</th><th className="num">ROAS</th></tr></thead>
          <tbody>
            {perLevel.map((l) => (
              <tr key={l.v}>
                <td><span style={badge(l.c)}>{l.l}</span></td>
                <td className="num" style={{ fontWeight: 600 }}>{rpFull(l.spent)}</td>
                <td className="num">{roasF(l.roas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 12 }}>
        Ads Spent = Σ Biaya · ROAS = Σ GMV ÷ Σ Biaya for that level this month. Send me your exact formulas (e.g. manual Incubation spend split, Analisa column) and I&apos;ll wire them in.
      </div>
    </div>
  );
}

/* ════════════════ Upload Iklan card ════════════════ */
function UploadIklan({ clientId, supabase, onUploaded }: {
  clientId: string; supabase: ReturnType<typeof createClient>; onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [m, setM] = useState({ year: new Date().getFullYear(), bulan: "", week: "Week 1", pic_client: "", brand: "", store_name: "", grup_iklan: "", ads_level: "" });
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
      <h3 style={{ margin: 0 }}>Upload Iklan</h3>
      <div className="hint" style={{ marginBottom: 16 }}>Export <b>one ad group per file</b> from Shopee. Select dealer, level &amp; period, then upload.</div>

      {/* row 1: owner / brand / store / grup / level */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
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
        <div className="fld"><label>Ads Level</label>
          <select value={m.ads_level} onChange={(e) => setM((s) => ({ ...s, ads_level: e.target.value }))}>
            <option value="">Select level…</option>
            {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
          </select>
        </div>
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

/* ── small bits ── */
function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: accent ? "rgba(201,162,39,.1)" : "rgba(10,22,40,.55)", border: `1px solid ${accent ? "rgba(201,162,39,.3)" : "var(--line)"}`, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "#7b8db0", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "9px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
    background: active ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
    color: active ? "var(--navy-deep)" : "#cdd9f0",
  };
}
function badge(color: string): React.CSSProperties {
  return { display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, color, background: color + "22", border: `1px solid ${color}55`, marginLeft: 4 };
}
const modalInput: React.CSSProperties = {
  marginTop: 6, width: "100%", boxSizing: "border-box", padding: "4px 7px", borderRadius: 7,
  border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.7)", color: "#e8edf8", fontSize: 11, textAlign: "right",
};
const trashBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 13, opacity: .7, padding: 0 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const drawer: React.CSSProperties = { width: "min(96vw,1500px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
const sumCell: React.CSSProperties = { background: "rgba(13,26,54,.95)", padding: "12px 14px" };
