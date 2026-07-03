"use client";

import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
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
type Formulation = {
  year: number; month: string; store_name: string;
  incubation_spent: number | null; incubation_roas: number | null;
  hero_spent: number | null; hero_roas: number | null;
  independent_spent: number | null; independent_roas: number | null;
  low_conversion_spent: number | null; low_conversion_roas: number | null;
};

/* ── constants ── */
const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const MONTH_ORDER = ["Baseline", ...MONTHS];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const LEVELS = [
  { v: "incubation",     l: "Incubation",     c: "#3b82f6" },
  { v: "hero",           l: "Hero",           c: "#c9a227" },
  { v: "regular",        l: "Independent Ads", c: "#8b5cf6" },
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

/* Analisa recommendation for one product, given its group's ads_level and the
   month's formulation thresholds. Returns null when no switch is recommended. */
function analisa(adsLevel: string | null, roas: number, biaya: number, f: Formulation | null): { text: string; tone: "up" | "down" } | null {
  if (!f || !adsLevel) return null;
  const gt = (a: number, b: number | null) => b != null && a > b;
  const lt = (a: number, b: number | null) => b != null && a < b;
  if (adsLevel === "incubation") {
    if (gt(roas, f.incubation_roas) && gt(biaya, f.incubation_spent)) return { text: "Switch to Hero Group", tone: "up" };
  } else if (adsLevel === "hero") {
    if (gt(roas, f.hero_roas) && gt(biaya, f.hero_spent)) return { text: "Switch to Independent Ads", tone: "up" };
    if (lt(roas, f.low_conversion_roas) && gt(biaya, f.low_conversion_spent)) return { text: "Switch to Low Conversion Group", tone: "down" };
  } else if (adsLevel === "regular") { // Regular == Independent Ads
    if (lt(roas, f.independent_roas) && gt(biaya, f.independent_spent)) return { text: "Switch to Hero Group", tone: "down" };
  }
  return null;
}

/* ════════════════════════════════════════════════════════════════════ */
export default function AdsPerformancePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [role, setRole] = useState("");
  const [tab, setTab] = useState<"performance" | "formulation">("performance");

  const [rows, setRows] = useState<AdRow[]>([]);
  const [modals, setModals] = useState<ModalRow[]>([]);
  const [formulas, setFormulas] = useState<Formulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async (cid: string) => {
    setLoading(true);
    const [rGroups, rModals, rFormulas] = await Promise.all([
      supabase.from("ad_groups")
        .select("upload_id,year,month,week,store_name,pic_client,brand,grup_iklan,ads_level,level,item_name,kode_produk,biaya,omzet")
        .eq("client_id", cid),
      supabase.from("ad_modals").select("store_name,grup_iklan,year,month,week,modal_harian").eq("client_id", cid),
      supabase.from("ad_formulation").select("year,month,store_name,incubation_spent,incubation_roas,hero_spent,hero_roas,independent_spent,independent_roas,low_conversion_spent,low_conversion_roas").eq("client_id", cid),
    ]);
    // Surface the first real error (e.g. "relation ad_groups does not exist"
    // when a migration hasn't been run yet) instead of silently going empty.
    const err = rGroups.error || rModals.error || rFormulas.error;
    setLoadErr(err ? `${err.message} (code: ${err.code || "?"})` : "");
    setRows((rGroups.data as AdRow[]) || []);
    setModals((rModals.data as ModalRow[]) || []);
    setFormulas((rFormulas.data as Formulation[]) || []);
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
      {loadErr && (
        <div style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, color: "#fca5a5", fontSize: 13, fontFamily: "monospace" }}>
          ⚠ Database error loading Ads Performance data: {loadErr}
          <div style={{ marginTop: 4, color: "#f87171", fontFamily: "inherit" }}>
            This usually means a required Supabase migration hasn&apos;t been run yet (0018–0022).
          </div>
        </div>
      )}

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
          rows={rows} modals={modals} formulas={formulas} loading={loading} clientId={clientId}
          supabase={supabase} canUpload={canUpload} canDelete={canDelete}
          reload={() => load(clientId)}
        />
      ) : (
        <FormulationTab
          rows={rows} formulas={formulas} clientId={clientId}
          supabase={supabase} canEdit={canUpload} reload={() => load(clientId)}
        />
      )}
    </>
  );
}

/* ════════════════ Performance tab ════════════════ */
function PerformanceTab({ rows, modals, formulas, loading, clientId, supabase, canUpload, canDelete, reload }: {
  rows: AdRow[]; modals: ModalRow[]; formulas: Formulation[]; loading: boolean; clientId: string;
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

  // formulation thresholds for the current month (falls back to the latest
  // month for the selected year when no month is picked, e.g. Month-vs-Month)
  const activeFormula = useMemo(() => {
    const y = fYear ? Number(fYear) : undefined;
    const cands = formulas.filter((x) => (y == null || x.year === y));
    if (fMonth) return cands.find((x) => x.month === fMonth) || null;
    return cands.slice().sort((a, b) => MONTH_ORDER.indexOf(b.month) - MONTH_ORDER.indexOf(a.month))[0] || null;
  }, [formulas, fYear, fMonth]);

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
            <PeriodTableHead leadCols={["Dealer", "Grup Iklan"]} periods={periods} trailCols={[""]} />
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
                        <Fragment key={p}>
                          <td className="num" style={{ fontWeight: 600, borderLeft: "1px solid var(--line)" }}>
                            {rpC(a.biaya)}
                            {mode === "week" && (
                              canUpload ? (
                                <input
                                  defaultValue={modalMap.get(modalKey(g.store, g.grup, p)) ?? ""}
                                  onClick={(e) => e.stopPropagation()}
                                  onBlur={(e) => saveModal(g.store, g.grup, p, e.target.value)}
                                  placeholder="Modal/hari"
                                  style={modalInput}
                                />
                              ) : (
                                modalMap.get(modalKey(g.store, g.grup, p)) != null && (
                                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                                    Modal: {modalMap.get(modalKey(g.store, g.grup, p))}
                                  </div>
                                )
                              )
                            )}
                          </td>
                          <td className="num" style={{ fontSize: 12.5 }}>{a.gmv ? rpC(a.gmv) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                          <td className="num" style={{ fontSize: 12, color: "#cdd9f0" }}>{roasF(roasOf(a))}</td>
                        </Fragment>
                      );
                    })}
                    <PeriodTds a={tot} bold />
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
                <tr><td colSpan={2 + periods.length * 3 + 3 + 1} style={{ textAlign: "center", color: "var(--muted)", padding: 26 }}>
                  {loading ? "Loading…" : rows.length ? "No groups match these filters" : "No Grup Iklan uploaded yet — use the upload box above."}
                </td></tr>
              )}
              {groupRows.length > 0 && (
                <tr style={{ borderTop: "2px solid var(--line)" }}>
                  <td style={{ fontWeight: 800 }}>TOTAL</td><td></td>
                  {periods.map((p) => <PeriodTds key={p} a={grand.per.get(p) || { biaya: 0, gmv: 0 }} bold />)}
                  <PeriodTds a={grand.total} bold />
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
          formula={activeFormula}
          rows={rows.filter((r) => r.store_name === drill.store && r.grup_iklan === drill.grup &&
            (!fYear || String(r.year) === fYear) && (mode === "month" || !fMonth || r.month === fMonth) && (!fLevel || r.ads_level === fLevel))}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

/* ── two-row table head: period labels spanning 3 sub-columns (Biaya/GMV/ROAS) ── */
function PeriodTableHead({ leadCols, periods, trailCols }: { leadCols: React.ReactNode[]; periods: string[]; trailCols?: React.ReactNode[] }) {
  return (
    <thead>
      <tr>
        {leadCols.map((c, i) => <th key={`l${i}`} rowSpan={2} style={{ verticalAlign: "bottom" }}>{c}</th>)}
        {periods.map((p) => <th key={p} colSpan={3} className="num" style={groupTh}>{p}</th>)}
        <th colSpan={3} className="num" style={groupTh}>Total</th>
        {(trailCols || []).map((c, i) => <th key={`t${i}`} rowSpan={2} style={{ verticalAlign: "bottom" }}>{c}</th>)}
      </tr>
      <tr>
        {periods.map((p) => (
          <Fragment key={p}>
            <th className="num" style={subTh}>Biaya</th>
            <th className="num" style={subTh}>GMV</th>
            <th className="num" style={subTh}>ROAS</th>
          </Fragment>
        ))}
        <th className="num" style={subTh}>Biaya</th>
        <th className="num" style={subTh}>GMV</th>
        <th className="num" style={subTh}>ROAS</th>
      </tr>
    </thead>
  );
}

/* Biaya / GMV / ROAS rendered as 3 separate <td> cells (all white text) */
function PeriodTds({ a, bold }: { a: Agg; bold?: boolean }) {
  return (
    <>
      <td className="num" style={{ fontWeight: bold ? 800 : 600 }}>{rpC(a.biaya)}</td>
      <td className="num" style={{ fontSize: 12.5 }}>{a.gmv ? rpC(a.gmv) : <span style={{ color: "var(--muted)" }}>—</span>}</td>
      <td className="num" style={{ fontSize: 12, color: "#cdd9f0" }}>{roasF(roasOf(a))}</td>
    </>
  );
}

/* ════════════════ Drill-down overlay ════════════════ */
function DrillDown({ store, grup, mode, periods, rows, formula, onClose }: {
  store: string; grup: string; mode: Mode; periods: string[]; rows: AdRow[]; formula: Formulation | null; onClose: () => void;
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
            {!formula && (
              <div style={{ color: "#f59e0b", marginTop: 4, fontSize: 12 }}>
                ⚠ No Formulation thresholds set for this month — the Analisa column stays blank. Fill them in the Formulation tab.
              </div>
            )}
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
            <PeriodTableHead leadCols={["Kode Produk", "Nama Iklan / Produk", "Analisa"]} periods={periods} />
            <tbody>
              {products.map((pr) => {
                const t = prodTotal(pr.name);
                const rec = analisa(rows[0]?.ads_level ?? null, roasOf(t), t.biaya, formula);
                return (
                  <tr key={pr.name}>
                    <td style={{ color: "#9ab0cc", fontSize: 12 }}>{pr.kode}</td>
                    <td style={{ maxWidth: 260, fontSize: 12.5 }}>{pr.name}</td>
                    <td style={{ textAlign: "center" }}>
                      {rec ? (
                        <span style={badge(rec.tone === "up" ? "#3b82f6" : "#ef4444")}>{rec.text}</span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    {periods.map((p) => <PeriodTds key={p} a={prodPer(pr.name, p)} />)}
                    <PeriodTds a={t} bold />
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={3 + periods.length * 3 + 3} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>No product rows</td></tr>
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
// The 4 tiers as (data ads_level value → formulation field prefix) pairs.
// Note the data level "regular" maps to the "independent" formulation fields.
const FORM_TIERS = [
  { level: "incubation",     key: "incubation",     label: "Incubation - Hero",      c: "#3b82f6" },
  { level: "hero",           key: "hero",           label: "Hero - Independent Ads", c: "#c9a227" },
  { level: "regular",        key: "independent",    label: "Independent Ads - Hero", c: "#8b5cf6" },
  { level: "low_conversion", key: "low_conversion", label: "All - Low Conversion",   c: "#ef4444" },
] as const;

type FormFields = {
  incubation_spent: string; incubation_roas: string;
  hero_spent: string; hero_roas: string;
  independent_spent: string; independent_roas: string;
  low_conversion_spent: string; low_conversion_roas: string;
};
const emptyFields: FormFields = {
  incubation_spent: "", incubation_roas: "", hero_spent: "", hero_roas: "",
  independent_spent: "", independent_roas: "", low_conversion_spent: "", low_conversion_roas: "",
};

function FormulationTab({ rows, formulas, clientId, supabase, canEdit, reload }: {
  rows: AdRow[]; formulas: Formulation[]; clientId: string;
  supabase: ReturnType<typeof createClient>; canEdit: boolean; reload: () => void;
}) {
  // Store options come from the CORE LIST (store_links) — always available,
  // independent of whether any sales/ads data has been uploaded yet. Month is
  // the fixed 12-month calendar (thresholds are config, may be set ahead of
  // data); Year is a small range around now unioned with any year present in
  // ad data. This is what "connect to Core List" means — the picker no longer
  // waits on the heavy dashboard_filters() aggregation.
  const [coreStores, setCoreStores] = useState<string[]>([]);
  const [year, setYear] = useState("");
  const nowY = new Date().getFullYear();
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [store, setStore] = useState("");
  const [baseline, setBaseline] = useState<number | null>(null);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data } = await supabase.from("store_links").select("store_name").eq("client_id", clientId);
      const s = Array.from(new Set(((data as { store_name: string | null }[]) || [])
        .map((x) => x.store_name).filter(Boolean) as string[])).sort();
      setCoreStores(s);
    })();
  }, [clientId, supabase]);

  const years = useMemo(() =>
    Array.from(new Set([nowY, nowY - 1, ...rows.map((r) => r.year).filter(Boolean) as number[]])).sort((a, b) => b - a),
  [rows, nowY]);
  const months = MONTHS;
  const stores = useMemo(() =>
    Array.from(new Set([...coreStores, ...rows.map((r) => r.store_name).filter(Boolean) as string[]])).sort(),
  [coreStores, rows]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!year && years.length) setYear(String(years[0])); }, [years, year]);

  // thresholds are unique PER STORE — an empty store_name ("") means the
  // "All Stores" bucket, kept separate from any individual store's values.
  const stored = useMemo(() =>
    formulas.find((f) => String(f.year) === year && f.month === month && f.store_name === store) || null,
  [formulas, year, month, store]);

  // actual per-level spend/ROAS from uploaded Grup Iklan data (reference)
  const scope = useMemo(() => rows.filter((r) =>
    r.level === "group" && String(r.year) === year && r.month === month && (!store || r.store_name === store)
  ), [rows, year, month, store]);
  const actualFor = (lvl: string) => { const a = sumAgg(scope.filter((r) => r.ads_level === lvl)); return { spent: a.biaya, roas: roasOf(a) }; };

  // baseline "Existing ROAS" = the main Dashboard's ROAS for this month (+ store if picked).
  // setState only ever happens inside the async callback (never synchronously).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!year || !month) { if (!cancelled) setBaseline(null); return; }
      const { data } = await supabase.rpc("dashboard_summary", {
        p_year: Number(year), p_month: month, p_city: null, p_owner: null, p_brand: null, p_store: store || null,
      });
      const roas = (data as { kpis?: { roas?: number | null } } | null)?.kpis?.roas;
      if (!cancelled) setBaseline(roas ?? null);
    })();
    return () => { cancelled = true; };
  }, [year, month, store, supabase]);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Formulation</h3>
          <div className="hint">Set the monthly thresholds that drive the Analisa switch recommendations.</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="fld" style={{ minWidth: 150 }}><label>Store</label>
            <select value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">All Stores</option>
              {stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld" style={{ minWidth: 110 }}><label>Year</label>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.length ? years.map((y) => <option key={y} value={String(y)}>{y}</option>) : <option value="">—</option>}
            </select>
          </div>
          <div className="fld" style={{ minWidth: 130 }}><label>Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* baseline */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 18 }}>
        <StatCard label="Existing ROAS (Dashboard)" value={baseline != null ? roasF(baseline) : "—"} sub={`Baseline · ${store || "All Stores"} · ${month || "—"} ${year || ""}`} accent />
      </div>

      {!store && (
        <div style={{ fontSize: 12.5, color: "#f59e0b", marginBottom: 10 }}>
          ⚠ Pick a specific store to save its thresholds — thresholds are per-store, not shared.
        </div>
      )}

      {/* keyed so local field state re-initialises from `stored` on month/store change */}
      <ThresholdEditor
        key={`${year}|${month}|${store}`}
        stored={stored} canEdit={canEdit && !!store} year={year} month={month} store={store}
        clientId={clientId} supabase={supabase} actualFor={actualFor} reload={reload}
      />

      <WorkflowDiagram />

      <div className="hint" style={{ marginTop: 16, lineHeight: 1.7 }}>
        <b style={{ color: "#cdd9f0" }}>Analisa switch rules</b> (per product, using its monthly Biaya &amp; ROAS):<br />
        • <b>Incubation</b> → “Switch to Hero Group” when ROAS &gt; Incubation ROAS <i>and</i> Biaya &gt; Incubation Ads Spent<br />
        • <b>Hero</b> → “Switch to Independent Ads” when ROAS &gt; Hero ROAS <i>and</i> Biaya &gt; Hero Ads Spent<br />
        • <b>Hero</b> → “Switch to Low Conversion Group” when ROAS &lt; Low Conversion ROAS <i>and</i> Biaya &gt; Low Conversion Ads Spent<br />
        • <b>Independent</b> → “Switch to Hero Group” when ROAS &lt; Independent ROAS <i>and</i> Biaya &gt; Independent Ads Spent
      </div>
    </div>
  );
}

/* ── "Maximize Ads Work Flow" diagram (recreated to match the app theme) ── */
function WorkflowDiagram() {
  const box = (x: number, w: number, label: string, color: string) => (
    <g>
      <rect x={x} y={40} width={w} height={54} rx={10} fill="rgba(10,22,40,.75)" stroke={color} strokeWidth={1.5} />
      <text x={x + w / 2} y={72} textAnchor="middle" fill="#e8edf8" fontSize="13" fontWeight={700}>{label}</text>
    </g>
  );
  return (
    <div style={{ marginTop: 20, padding: 18, borderRadius: 14, border: "1px solid var(--line)", background: "rgba(10,22,40,.4)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10 }}>
        Maximize Ads Work Flow
      </div>
      <svg viewBox="0 0 760 220" style={{ width: "100%", height: "auto", maxWidth: 720 }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#c9a227" />
          </marker>
        </defs>
        {/* Incubation -> Hero */}
        {box(20, 140, "Group Incubation", "#3b82f6")}
        <line x1="160" y1="67" x2="290" y2="67" stroke="#c9a227" strokeWidth="1.5" markerEnd="url(#arrow)" />
        {/* Hero */}
        {box(300, 140, "Group Hero", "#c9a227")}
        {/* Hero -> Independent */}
        <line x1="440" y1="67" x2="580" y2="67" stroke="#c9a227" strokeWidth="1.5" markerEnd="url(#arrow)" />
        {/* Independent */}
        {box(590, 150, "Independent Ads", "#8b5cf6")}
        {/* Hero <-> Low Conversion loop */}
        <rect x={300} y={150} width={140} height={54} rx={10} fill="rgba(10,22,40,.75)" stroke="#ef4444" strokeWidth="1.5" />
        <text x={370} y={182} textAnchor="middle" fill="#e8edf8" fontSize="13" fontWeight={700}>Low Conversion</text>
        <path d="M330,94 L330,150" stroke="#ef4444" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <path d="M410,150 L410,94" stroke="#ef4444" strokeWidth="1.5" markerEnd="url(#arrow)" />
        {/* Independent -> Hero (demote) */}
        <path d="M660,150 C660,190 480,190 440,94" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrow)" />
        <text x="560" y="205" textAnchor="middle" fill="#9ab0cc" fontSize="10">low ROAS → back to Hero</text>
      </svg>
    </div>
  );
}

// Rupiah thousand-separator formatting: "23000" -> "23,000" (comma, per request).
function formatRpInput(digits: string): string {
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}
function stripToDigits(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

/* ── Threshold editor (keyed by year|month|store → fresh state per store) ── */
function ThresholdEditor({ stored, canEdit, year, month, store, clientId, supabase, actualFor, reload }: {
  stored: Formulation | null; canEdit: boolean; year: string; month: string; store: string;
  clientId: string; supabase: ReturnType<typeof createClient>;
  actualFor: (lvl: string) => { spent: number; roas: number }; reload: () => void;
}) {
  const s = (v: number | null | undefined) => (v == null ? "" : String(v));
  const [fields, setFields] = useState<FormFields>(() => stored ? {
    incubation_spent: s(stored.incubation_spent), incubation_roas: s(stored.incubation_roas),
    hero_spent: s(stored.hero_spent), hero_roas: s(stored.hero_roas),
    independent_spent: s(stored.independent_spent), independent_roas: s(stored.independent_roas),
    low_conversion_spent: s(stored.low_conversion_spent), low_conversion_roas: s(stored.low_conversion_roas),
  } : emptyFields);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const setF = (k: keyof FormFields, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const numOrNull = (v: string) => v.trim() === "" ? null : Number(v);

  async function save() {
    if (!year || !month) { setMsg("Pick a year and month first."); return; }
    setSaving(true); setMsg("");
    const { error } = await supabase.from("ad_formulation").upsert({
      client_id: clientId, store_name: store, year: Number(year), month,
      incubation_spent: numOrNull(fields.incubation_spent), incubation_roas: numOrNull(fields.incubation_roas),
      hero_spent: numOrNull(fields.hero_spent), hero_roas: numOrNull(fields.hero_roas),
      independent_spent: numOrNull(fields.independent_spent), independent_roas: numOrNull(fields.independent_roas),
      low_conversion_spent: numOrNull(fields.low_conversion_spent), low_conversion_roas: numOrNull(fields.low_conversion_roas),
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id,store_name,year,month" });
    setSaving(false);
    if (error) { setMsg("✗ " + error.message); return; }
    setMsg("✓ Saved"); reload();
  }

  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl" style={{ color: "#e8edf8" }}>
          <thead>
            <tr>
              <th>Ads Level</th>
              <th className="num" style={{ width: 160 }}>Ads Spent (threshold)</th>
              <th className="num" style={{ width: 110 }}>ROAS (threshold)</th>
              <th className="num">Actual Spent</th>
              <th className="num">Actual ROAS</th>
            </tr>
          </thead>
          <tbody>
            {FORM_TIERS.map((t) => {
              const act = actualFor(t.level);
              const spentKey = `${t.key}_spent` as keyof FormFields;
              const roasKey  = `${t.key}_roas`  as keyof FormFields;
              return (
                <tr key={t.key}>
                  <td><span style={badge(t.c)}>{t.label}</span></td>
                  <td className="num">
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <span style={{ ...fInput, display: "flex", alignItems: "center", gap: 4, padding: "6px 9px" }}>
                        <span style={{ color: "var(--muted)" }}>Rp</span>
                        <input type="text" inputMode="numeric" value={formatRpInput(fields[spentKey])} disabled={!canEdit}
                          onChange={(e) => setF(spentKey, stripToDigits(e.target.value))} placeholder="0"
                          style={{ border: "none", background: "transparent", color: "inherit", fontSize: "inherit", textAlign: "right", width: "100%", padding: 0, outline: "none" }} />
                      </span>
                    </div>
                  </td>
                  <td className="num">
                    <input type="number" step="0.01" value={fields[roasKey]} disabled={!canEdit}
                      onChange={(e) => setF(roasKey, e.target.value)} placeholder="×" style={fInput} />
                  </td>
                  <td className="num" style={{ color: "var(--muted)", fontSize: 12 }}>{rpFull(act.spent)}</td>
                  <td className="num" style={{ color: "var(--muted)", fontSize: 12 }}>{roasF(act.roas)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
          <button className="btn-gold" onClick={save} disabled={saving} style={{ padding: "9px 28px" }}>{saving ? "Saving…" : "Save Thresholds"}</button>
          {msg && <span style={{ fontSize: 12.5, color: msg.startsWith("✓") ? "#86efac" : "#f87171" }}>{msg}</span>}
        </div>
      )}
    </>
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
const groupTh: React.CSSProperties = { borderLeft: "1px solid var(--line)" };
const subTh: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9ab0cc", padding: "6px 10px" };
const fInput: React.CSSProperties = {
  width: 130, boxSizing: "border-box", padding: "6px 9px", borderRadius: 8, textAlign: "right",
  border: "1px solid rgba(201,162,39,.3)", background: "rgba(10,22,40,.7)", color: "#e8edf8", fontSize: 13,
};
const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(2,6,16,.82)", backdropFilter: "blur(4px)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 20px", overflowY: "auto" };
const drawer: React.CSSProperties = { width: "min(96vw,1500px)", background: "var(--card,#0d1a36)", border: "1px solid var(--card-border,rgba(201,162,39,.2))", borderRadius: 18, padding: 24, boxShadow: "0 30px 80px rgba(0,0,0,.7)" };
const sumCell: React.CSSProperties = { background: "rgba(13,26,54,.95)", padding: "12px 14px" };
