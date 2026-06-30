"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/* ── types ── */
type AdRow = {
  year: number | null; month: string | null; week: string | null;
  store_name: string | null; pic_client: string | null; brand: string | null;
  grup_iklan: string | null; level: string; item_name: string | null;
  biaya: number | null; omzet: number | null; penjualan_langsung: number | null;
  roas: number | null;
};
type UploadRow = {
  id: string; filename: string | null; row_count: number; created_at: string;
  meta: { pic_client?: string; store_name?: string; bulan?: string; week?: string; year?: number; grup_iklan?: string } | null;
};
type Link = { owner: string | null; brand: string | null; store_name: string | null };
type Metric = "biaya" | "penjualan_langsung" | "roas";
type Mode = "week" | "month";

/* ── constants ── */
const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const MONTH_ORDER = ["Baseline", ...MONTHS];
const WEEKS = ["Week 1","Week 2","Week 3","Week 4","Week 5"];
const PALETTE = ["#c9a227","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#14b8a6","#e8c84a"];

const METRICS: { v: Metric; label: string; money: boolean }[] = [
  { v: "biaya", label: "Biaya (Cost)", money: true },
  { v: "penjualan_langsung", label: "Penjualan Langsung", money: true },
  { v: "roas", label: "ROAS (Efektifitas)", money: false },
];

const idr  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const idrF = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const roasF = (n: number) => (n || 0).toFixed(2) + "×";

/* ════════════════════════════════════════════════════════════════════ */
export default function AdsPerformancePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [role, setRole] = useState("");
  const [rows, setRows] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);

  // controls
  const [mode, setMode] = useState<Mode>("week");
  const [metric, setMetric] = useState<Metric>("biaya");
  const [fStore, setFStore] = useState("");
  const [fGrup, setFGrup] = useState("");
  const [fYear, setFYear] = useState("");
  const [fMonth, setFMonth] = useState(""); // which month's weeks (week mode)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadRows = useCallback(async (cid: string) => {
    setLoading(true);
    const { data } = await supabase.from("ad_groups")
      .select("year,month,week,store_name,pic_client,brand,grup_iklan,level,item_name,biaya,omzet,penjualan_langsung,roas")
      .eq("client_id", cid);
    setRows((data as AdRow[]) || []);
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
      if (cid) loadRows(cid);
    })();
  }, [supabase, loadRows]);

  /* derived filter option lists */
  const stores = useMemo(() => Array.from(new Set(rows.map((r) => r.store_name).filter(Boolean) as string[])).sort(), [rows]);
  const years  = useMemo(() => Array.from(new Set(rows.map((r) => r.year).filter(Boolean) as number[])).sort((a,b)=>b-a), [rows]);
  const months = useMemo(() =>
    Array.from(new Set(rows.map((r) => r.month).filter(Boolean) as string[]))
      .sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b)), [rows]);
  const grups = useMemo(() =>
    Array.from(new Set(rows.filter((r)=>!fStore||r.store_name===fStore).map((r)=>r.grup_iklan).filter(Boolean) as string[])).sort(), [rows, fStore]);

  /* base scope (respect store / grup / year filters) */
  const scoped = useMemo(() => rows.filter((r) =>
    (!fStore || r.store_name === fStore) &&
    (!fGrup  || r.grup_iklan === fGrup) &&
    (!fYear  || String(r.year) === fYear)
  ), [rows, fStore, fGrup, fYear]);

  /* the period axis */
  const periods = useMemo(() => {
    if (mode === "week") {
      const present = new Set(scoped.filter((r)=>!fMonth||r.month===fMonth).map((r)=>r.week).filter(Boolean) as string[]);
      return WEEKS.filter((w) => present.has(w));
    }
    return Array.from(new Set(scoped.map((r)=>r.month).filter(Boolean) as string[]))
      .sort((a,b)=>MONTH_ORDER.indexOf(a)-MONTH_ORDER.indexOf(b));
  }, [scoped, mode, fMonth]);

  /* group-level rows in scope (one ad group total per period) */
  const groupRows = useMemo(() => scoped.filter((r) =>
    r.level === "group" && (mode === "month" || !fMonth || r.month === fMonth)
  ), [scoped, mode, fMonth]);

  const productRows = useMemo(() => scoped.filter((r) =>
    r.level === "product" && (mode === "month" || !fMonth || r.month === fMonth)
  ), [scoped, mode, fMonth]);

  const periodKey = useCallback((r: AdRow) => (mode === "week" ? r.week : r.month) || "", [mode]);

  /* metric value from summed components */
  const calc = useCallback((agg: { biaya: number; penjualan: number; omzet: number }): number => {
    if (metric === "biaya") return agg.biaya;
    if (metric === "penjualan_langsung") return agg.penjualan;
    return agg.biaya ? agg.omzet / agg.biaya : 0; // roas = omzet/biaya
  }, [metric]);

  /* aggregate helper: sum components for a filtered set */
  function aggregate(set: AdRow[]) {
    const m = new Map<string, { biaya: number; penjualan: number; omzet: number }>();
    for (const r of set) {
      const k = periodKey(r);
      if (!k) continue;
      const e = m.get(k) || { biaya: 0, penjualan: 0, omzet: 0 };
      e.biaya     += r.biaya ?? 0;
      e.penjualan += r.penjualan_langsung ?? 0;
      e.omzet     += r.omzet ?? 0;
      m.set(k, e);
    }
    return m;
  }

  /* list of grups present in the group rows */
  const grupList = useMemo(() =>
    Array.from(new Set(groupRows.map((r)=>r.grup_iklan).filter(Boolean) as string[])).sort(), [groupRows]);

  /* chart data: [{ period, <grup>: value, … }] */
  const chartData = useMemo(() => {
    const perGrup = new Map<string, Map<string, { biaya:number; penjualan:number; omzet:number }>>();
    for (const g of grupList) perGrup.set(g, aggregate(groupRows.filter((r)=>r.grup_iklan===g)));
    return periods.map((p) => {
      const row: Record<string, string | number> = { period: p };
      for (const g of grupList) {
        const agg = perGrup.get(g)?.get(p);
        row[g] = agg ? calc(agg) : 0;
      }
      return row;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupList, groupRows, periods, calc, mode]);

  /* table: per grup → per period metric, plus product breakdown */
  const tableData = useMemo(() => grupList.map((g) => {
    const agg = aggregate(groupRows.filter((r)=>r.grup_iklan===g));
    const cells = periods.map((p) => { const a = agg.get(p); return a ? calc(a) : null; });
    const totals = { biaya:0, penjualan:0, omzet:0 };
    for (const a of agg.values()) { totals.biaya+=a.biaya; totals.penjualan+=a.penjualan; totals.omzet+=a.omzet; }
    // products inside this grup
    const prodNames = Array.from(new Set(productRows.filter((r)=>r.grup_iklan===g).map((r)=>r.item_name).filter(Boolean) as string[]));
    const products = prodNames.map((nm) => {
      const pa = aggregate(productRows.filter((r)=>r.grup_iklan===g && r.item_name===nm));
      return { name: nm, cells: periods.map((p)=>{ const a=pa.get(p); return a?calc(a):null; }) };
    });
    return { grup: g, cells, total: calc(totals), products };
  }), [grupList, groupRows, productRows, periods, calc]);

  const activeMetric = METRICS.find((m)=>m.v===metric)!;
  const fmtCell = (v: number | null) => v == null ? "—" : (metric === "roas" ? roasF(v) : idr(v));

  function toggle(g: string) {
    setExpanded((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  }

  const canUpload = ["superadmin","client_admin","advertiser"].includes(role);

  return (
    <>
      {/* ── Upload widget ── */}
      {canUpload && (
        <UploadGrupIklan clientId={clientId} supabase={supabase} onUploaded={() => loadRows(clientId)} />
      )}

      {/* ── Controls ── */}
      <div className="panel" style={{ marginTop: 18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginBottom:14 }}>
          <div>
            <h3 style={{ margin:0 }}>Ads Group Performance</h3>
            <div className="hint">Compare each Grup Iklan {mode==="week"?"week-to-week":"month-to-month"} · {activeMetric.label}</div>
          </div>
          {loading && <span style={{ color:"#c9a227", fontSize:12 }}>Loading…</span>}
        </div>

        {/* compare mode + metric toggles */}
        <div style={{ display:"flex", gap:18, flexWrap:"wrap", alignItems:"flex-end", marginBottom:14 }}>
          <div>
            <label style={lblStyle}>Compare</label>
            <div style={{ display:"flex", gap:6 }}>
              {(["week","month"] as Mode[]).map((m) => (
                <button key={m} onClick={()=>setMode(m)} style={pillBtn(mode===m)}>
                  {m==="week"?"Week v Week":"Month v Month"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lblStyle}>Metric</label>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {METRICS.map((m) => (
                <button key={m.v} onClick={()=>setMetric(m.v)} style={pillBtn(metric===m.v)}>{m.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* filter selects */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr) auto", gap:10, alignItems:"end" }}>
          <div className="fld"><label>Store</label>
            <select value={fStore} onChange={(e)=>{setFStore(e.target.value); setFGrup("");}}>
              <option value="">All stores</option>
              {stores.map((s)=> <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="fld"><label>Grup Iklan</label>
            <select value={fGrup} onChange={(e)=>setFGrup(e.target.value)}>
              <option value="">All groups</option>
              {grups.map((g)=> <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="fld"><label>Year</label>
            <select value={fYear} onChange={(e)=>setFYear(e.target.value)}>
              <option value="">All years</option>
              {years.map((y)=> <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div className="fld"><label>{mode==="week"?"Month (for weeks)":"Month"}</label>
            <select value={fMonth} onChange={(e)=>setFMonth(e.target.value)} disabled={mode==="month"}>
              <option value="">{mode==="week"?"All months":"—"}</option>
              {months.map((m)=> <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button className="btn-ghost" onClick={()=>{setFStore("");setFGrup("");setFYear("");setFMonth("");}} style={{ height:38 }}>Reset</button>
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="panel" style={{ marginTop:18 }}>
        <h3 style={{ margin:"0 0 2px" }}>{activeMetric.label} per Grup Iklan</h3>
        <div className="hint" style={{ marginBottom:14 }}>{mode==="week"?"Weekly":"Monthly"} trend · one line per ad group</div>
        {grupList.length === 0 || periods.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ width:"100%", height:330 }}>
            <ResponsiveContainer>
              {metric === "roas" ? (
                <LineChart data={chartData} margin={{ left:6, right:20, top:14, bottom:6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize:11, fill:"#7089aa" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize:10, fill:"#7089aa" }} tickFormatter={(v)=>roasF(Number(v))} axisLine={false} tickLine={false} width={48} />
                  <Tooltip contentStyle={TIP} formatter={(v, n) => [roasF(Number(v)), n as string]} />
                  <Legend wrapperStyle={{ fontSize:11 }} iconType="circle" iconSize={8} />
                  {grupList.map((g, i) => (
                    <Line key={g} type="monotone" dataKey={g} stroke={PALETTE[i%PALETTE.length]} strokeWidth={2.5}
                      dot={{ r:3 }} activeDot={{ r:5 }} />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ left:6, right:20, top:14, bottom:6 }} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize:11, fill:"#7089aa" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize:10, fill:"#7089aa" }} tickFormatter={(v)=>idr(Number(v))} axisLine={false} tickLine={false} width={56} />
                  <Tooltip contentStyle={TIP} formatter={(v, n) => [idrF(Number(v)), n as string]} cursor={{ fill:"rgba(201,162,39,0.04)" }} />
                  <Legend wrapperStyle={{ fontSize:11 }} iconType="circle" iconSize={8} />
                  {grupList.map((g, i) => (
                    <Bar key={g} dataKey={g} fill={PALETTE[i%PALETTE.length]} radius={[3,3,0,0]} />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── Comparison table ── */}
      <div className="panel" style={{ marginTop:18 }}>
        <h3 style={{ margin:"0 0 2px" }}>Comparison Table</h3>
        <div className="hint" style={{ marginBottom:14 }}>{activeMetric.label} · click a group to see its products</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Grup Iklan</th>
                {periods.map((p)=> <th key={p} className="num">{p}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((g) => (
                <FragmentRow key={g.grup} g={g} expanded={expanded.has(g.grup)}
                  onToggle={()=>toggle(g.grup)} fmtCell={fmtCell} metric={metric} />
              ))}
              {tableData.length === 0 && (
                <tr><td colSpan={periods.length+2} style={{ textAlign:"center", color:"var(--muted)", padding:24 }}>
                  {rows.length ? "No ad groups match these filters" : "No Grup Iklan uploaded yet — use the upload box above."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ── one grup row + its expandable product rows ── */
function FragmentRow({ g, expanded, onToggle, fmtCell, metric }: {
  g: { grup: string; cells: (number|null)[]; total: number; products: { name: string; cells: (number|null)[] }[] };
  expanded: boolean; onToggle: () => void;
  fmtCell: (v: number|null) => string; metric: Metric;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor:"pointer" }}>
        <td style={{ fontWeight:600 }}>
          <span style={{ color:"#c9a227", marginRight:7, display:"inline-block", width:10 }}>{expanded?"▾":"▸"}</span>
          {g.grup}
          <span style={{ color:"var(--muted)", fontSize:11, marginLeft:8 }}>({g.products.length})</span>
        </td>
        {g.cells.map((c, i)=> <td key={i} className="num">{fmtCell(c)}</td>)}
        <td className="num" style={{ fontWeight:700, color:"#c9a227" }}>{metric==="roas"?roasF(g.total):idr(g.total)}</td>
      </tr>
      {expanded && g.products.map((p, pi) => (
        <tr key={pi} style={{ background:"rgba(10,22,40,.35)" }}>
          <td style={{ paddingLeft:30, fontSize:12, color:"#bcd", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.name}>{p.name}</td>
          {p.cells.map((c, ci)=> <td key={ci} className="num" style={{ fontSize:12, color:"var(--muted)" }}>{fmtCell(c)}</td>)}
          <td className="num" style={{ color:"var(--muted)" }}>—</td>
        </tr>
      ))}
    </>
  );
}

/* ════════════════ Upload widget ════════════════ */
function UploadGrupIklan({ clientId, supabase, onUploaded }: {
  clientId: string;
  supabase: ReturnType<typeof createClient>;
  onUploaded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [manual, setManual] = useState({ year: new Date().getFullYear(), bulan: "", week: "Week 1", pic_client: "", brand: "", store_name: "" });
  const [links, setLinks] = useState<Link[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>("");
  const [uploads, setUploads] = useState<UploadRow[]>([]);

  const loadUploads = useCallback(async (cid: string) => {
    const { data } = await supabase.from("uploads")
      .select("id,filename,row_count,created_at,meta")
      .eq("client_id", cid).eq("source", "ads_group")
      .order("created_at", { ascending: false });
    setUploads((data as UploadRow[]) || []);
  }, [supabase]);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", clientId).order("created_at");
      const ld = (sl as Link[]) || [];
      setLinks(ld);
      setOwners(Array.from(new Set(ld.map((l)=>l.owner).filter(Boolean) as string[])).sort());
      loadUploads(clientId);
    })();
  }, [clientId, supabase, loadUploads]);

  const brandsForOwner = manual.pic_client
    ? Array.from(new Set(links.filter((l)=>l.owner===manual.pic_client).map((l)=>l.brand).filter(Boolean) as string[])).sort()
    : Array.from(new Set(links.map((l)=>l.brand).filter(Boolean) as string[])).sort();
  const storesForBrand = manual.brand
    ? links.filter((l)=>l.brand===manual.brand && (!manual.pic_client||l.owner===manual.pic_client)).map((l)=>l.store_name).filter(Boolean) as string[]
    : manual.pic_client
      ? links.filter((l)=>l.owner===manual.pic_client).map((l)=>l.store_name).filter(Boolean) as string[]
      : Array.from(new Set(links.map((l)=>l.store_name).filter(Boolean) as string[]));

  async function submit() {
    if (!file) { setLog("Pick a file first."); return; }
    if (!manual.bulan) { setLog("Select the month."); return; }
    if (!manual.store_name) { setLog("Select owner → brand → store."); return; }
    setBusy(true); setLog("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("client_id", clientId);
    fd.append("manual", JSON.stringify({ ...manual, tanggal_input: new Date().toISOString() }));
    try {
      const res = await fetch("/api/ads-group/upload", { method: "POST", body: fd });
      const j = await res.json();
      setLog(res.ok ? `✓ ${j.grup_iklan || "Grup"}: ${j.rows} rows imported` : `✗ ${j.error}`);
      if (res.ok) { setFile(null); loadUploads(clientId); onUploaded(); }
    } catch (e) { setLog("✗ " + String(e)); }
    setBusy(false);
  }

  async function del(id: string) {
    if (!confirm("Delete this upload and all its ad-group rows?")) return;
    await supabase.from("uploads").delete().eq("id", id);
    loadUploads(clientId); onUploaded();
  }

  return (
    <div className="panel">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }} onClick={()=>setOpen((o)=>!o)}>
        <div>
          <h3 style={{ margin:0 }}>⬆️ Upload Grup Iklan</h3>
          <div className="hint">Shopee “Data Grup Iklan” export · group name is auto-detected from the file.</div>
        </div>
        <span style={{ color:"#c9a227", fontSize:13 }}>{open?"▲ Hide":"▼ Show"}</span>
      </div>

      {open && (
        <div style={{ marginTop:16 }}>
          {/* period row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:12 }}>
            <div className="fld"><label>Year</label>
              <input type="number" value={manual.year} onChange={(e)=>setManual((m)=>({...m, year:Number(e.target.value)}))} />
            </div>
            <div className="fld"><label>Month</label>
              <select value={manual.bulan} onChange={(e)=>setManual((m)=>({...m, bulan:e.target.value}))}>
                <option value="">Month…</option>
                {MONTHS.map((m)=> <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="fld"><label>Week</label>
              <select value={manual.week} onChange={(e)=>setManual((m)=>({...m, week:e.target.value}))}>
                {WEEKS.map((w)=> <option key={w}>{w}</option>)}
              </select>
            </div>
          </div>
          {/* cascade row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:12 }}>
            <div className="fld"><label>Owner</label>
              <select value={manual.pic_client} onChange={(e)=>setManual((m)=>({...m, pic_client:e.target.value, brand:"", store_name:""}))}>
                <option value="">Select owner…</option>
                {owners.map((o)=> <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div className="fld"><label>Brand</label>
              <select value={manual.brand} onChange={(e)=>setManual((m)=>({...m, brand:e.target.value, store_name:""}))} disabled={!manual.pic_client}>
                <option value="">{manual.pic_client?"Select brand…":"Pick owner first"}</option>
                {brandsForOwner.map((b)=> <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="fld"><label>Store</label>
              <select value={manual.store_name} onChange={(e)=>setManual((m)=>({...m, store_name:e.target.value}))} disabled={!manual.brand}>
                <option value="">{manual.brand?"Select store…":"Pick brand first"}</option>
                {storesForBrand.map((s)=> <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {/* file + submit */}
          <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", padding:14, border:"1px dashed rgba(201,162,39,.35)", borderRadius:12, background:"rgba(15,32,64,.4)" }}>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={(e)=>setFile(e.target.files?.[0] ?? null)} style={{ fontSize:12, color:"#bcd", flex:1, minWidth:200 }} />
            <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding:"9px 28px" }}>{busy?"Uploading…":"Upload"}</button>
          </div>
          {log && <div style={{ marginTop:10, fontSize:12, fontFamily:"monospace", color: log.startsWith("✓")?"#c9a227":"#f87171" }}>{log}</div>}

          {/* upload log */}
          {uploads.length > 0 && (
            <div className="tbl-wrap" style={{ marginTop:16 }}>
              <table className="tbl">
                <thead><tr><th>Grup</th><th>Store</th><th>Owner</th><th>Month</th><th>Week</th><th>Year</th><th className="num">Rows</th><th>File</th><th></th></tr></thead>
                <tbody>
                  {uploads.map((u)=>(
                    <tr key={u.id}>
                      <td style={{ fontWeight:600 }}>{u.meta?.grup_iklan || "—"}</td>
                      <td>{u.meta?.store_name || "—"}</td>
                      <td>{u.meta?.pic_client || "—"}</td>
                      <td>{u.meta?.bulan || "—"}</td>
                      <td>{u.meta?.week || "—"}</td>
                      <td>{u.meta?.year || "—"}</td>
                      <td className="num">{u.row_count}</td>
                      <td style={{ maxWidth:150, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={u.filename||""}>{u.filename||"—"}</td>
                      <td><button onClick={()=>del(u.id)} style={delBtn}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── bits ── */
function Empty() {
  return <div style={{ height:300, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted)", fontSize:13 }}>No ad-group data for these filters yet</div>;
}
const TIP: React.CSSProperties = { background:"rgba(6,14,33,0.97)", border:"1px solid rgba(201,162,39,0.35)", borderRadius:10, color:"#e8edf8", fontSize:12, padding:"8px 14px" };
const lblStyle: React.CSSProperties = { display:"block", fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", color:"#7b8db0", marginBottom:6 };
const delBtn: React.CSSProperties = { background:"rgba(255,80,80,.12)", border:"1px solid rgba(255,90,90,.3)", color:"#ff9a9a", borderRadius:7, padding:"4px 10px", cursor:"pointer", fontSize:12 };
function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding:"7px 14px", borderRadius:9, fontSize:12.5, fontWeight:600, cursor:"pointer",
    border:`1px solid ${active?"var(--gold)":"rgba(201,162,39,.22)"}`,
    background: active?"rgba(201,162,39,.16)":"rgba(10,22,40,.5)",
    color: active?"#f0d870":"var(--muted)",
  };
}
