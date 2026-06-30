"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/* ── Types ─────────────────────────────────────────────────────────────────── */
type Package = { id: string; name: string; type: string; months: number; price: number; sort_order: number; is_active: boolean };
type Invoice  = { id: string; owner: string | null; brand: string | null; store_name: string | null; package_name: string; package_type: string; price_idr: number; start_date: string; end_date: string | null; notes: string | null; created_at: string };
type StoreLink = { owner: string | null; brand: string | null; store_name: string | null };
type FormState = { owner: string; store_name: string; brand: string; package_name: string; price_idr: string; start_date: string; end_date: string; notes: string };

const emptyForm: FormState = { owner: "", store_name: "", brand: "", package_name: "", price_idr: "", start_date: "", end_date: "", notes: "" };
const emptyPkg = { id: "", name: "", type: "subscription", months: 3, price: 0, sort_order: 0, is_active: true };

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function addMonths(iso: string, n: number) { const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
function daysLeft(end: string) { const e = new Date(end + "T00:00:00"), n = new Date(); n.setHours(0,0,0,0); return Math.ceil((e.getTime()-n.getTime())/(864e5)); }
function fmtDate(iso: string) { if (!iso) return "—"; return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day:"2-digit", month:"short", year:"numeric" }); }
function fmtIDR(n: number) { return "Rp " + n.toLocaleString("id-ID"); }

/* ── Styles ─────────────────────────────────────────────────────────────────── */
const inp: React.CSSProperties = { width:"100%", padding:"9px 11px", borderRadius:10, border:"1px solid rgba(201,162,39,.25)", background:"rgba(10,22,40,.6)", color:"var(--text)", fontSize:13 };
const overlayStyle: React.CSSProperties = { position:"fixed", inset:0, background:"rgba(2,6,16,.75)", zIndex:9998, display:"flex", alignItems:"center", justifyContent:"center", padding:16 };
const modalStyle:  React.CSSProperties = { width:"min(94vw,540px)", maxHeight:"calc(100vh - 32px)", display:"flex", flexDirection:"column", background:"var(--card)", border:"1px solid var(--card-border)", borderRadius:18, boxShadow:"0 20px 60px rgba(0,0,0,.6)" };
const editBtn: React.CSSProperties = { background:"rgba(201,162,39,.12)", border:"1px solid rgba(201,162,39,.25)", color:"var(--gold)", borderRadius:7, padding:"4px 10px", cursor:"pointer", fontSize:12 };
const delBtn:  React.CSSProperties = { background:"rgba(255,80,80,.12)", border:"1px solid rgba(255,90,90,.3)", color:"#ff9a9a", borderRadius:7, padding:"4px 10px", cursor:"pointer", fontSize:12 };

function MFld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld" style={{ minWidth:0 }}><label>{label}</label>{children}</div>;
}
function Fld2({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display:"grid", gap:5 }}><label style={{ fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em", color:"#7b8db0" }}>{label}</label>{children}</div>;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Page
══════════════════════════════════════════════════════════════════════════════ */
export default function InvoicePage() {
  const [supabase]  = useState(() => createClient());
  const [tab, setTab] = useState<"invoices" | "products">("invoices");

  // Packages
  const [packages,  setPackages]  = useState<Package[]>([]);
  const [pkgForm,   setPkgForm]   = useState<Omit<Package,"id"|"created_at">>(emptyPkg);
  const [pkgEditId, setPkgEditId] = useState<string|null>(null);
  const [showPkgForm, setShowPkgForm] = useState(false);
  const [pkgMsg, setPkgMsg] = useState("");

  // Invoices
  const [clientId, setClientId] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [links,    setLinks]    = useState<StoreLink[]>([]);
  const [owners,   setOwners]   = useState<string[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState<FormState>(emptyForm);
  const [editId,   setEditId]   = useState<string|null>(null);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState("");
  const [flt, setFlt] = useState({ owner: "", package_name: "", month: "" });

  /* ── Loaders ── */
  const loadPackages = useCallback(async () => {
    const { data } = await supabase.from("packages").select("*").order("sort_order");
    setPackages((data as Package[]) || []);
  }, [supabase]);

  const loadInvoices = useCallback(async (cid: string) => {
    if (!cid) return;
    const { data } = await supabase.from("invoices")
      .select("id,owner,brand,store_name,package_name,package_type,price_idr,start_date,end_date,notes,created_at")
      .eq("client_id", cid).order("created_at", { ascending: false });
    setInvoices((data as Invoice[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      await loadPackages();
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const cid = (cs as {id:string}[])?.[0]?.id || "";
      setClientId(cid);
      if (!cid) return;
      const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", cid).order("created_at");
      const linkData = (sl as StoreLink[]) || [];
      setLinks(linkData);
      const uniq = (xs: (string|null)[]) => Array.from(new Set(xs.filter(Boolean) as string[])).sort();
      setOwners(uniq(linkData.map((l) => l.owner)));
      loadInvoices(cid);
    })();
  }, [supabase, loadPackages, loadInvoices]);

  /* ── Package CRUD ── */
  function openAddPkg() {
    setPkgForm({ ...emptyPkg, sort_order: packages.length + 1 });
    setPkgEditId(null); setPkgMsg(""); setShowPkgForm(true);
  }
  function openEditPkg(p: Package) {
    setPkgForm({ name:p.name, type:p.type, months:p.months, price:p.price, sort_order:p.sort_order, is_active:p.is_active });
    setPkgEditId(p.id); setPkgMsg(""); setShowPkgForm(true);
  }
  async function savePkg() {
    if (!pkgForm.name.trim()) { setPkgMsg("Name is required"); return; }
    const payload = { name:pkgForm.name.trim(), type:pkgForm.type, months:Number(pkgForm.months)||0, price:Number(pkgForm.price)||0, sort_order:Number(pkgForm.sort_order)||0, is_active:pkgForm.is_active };
    const { error } = pkgEditId
      ? await supabase.from("packages").update(payload).eq("id", pkgEditId)
      : await supabase.from("packages").insert(payload);
    if (error) { setPkgMsg("✗ " + error.message); return; }
    setShowPkgForm(false); loadPackages();
  }
  async function deletePkg(id: string, name: string) {
    if (!confirm(`Delete package "${name}"?`)) return;
    await supabase.from("packages").delete().eq("id", id);
    loadPackages();
  }

  /* ── Invoice helpers ── */
  function setF(k: keyof FormState, v: string) { setForm((f) => ({...f, [k]:v})); }

  function pickPackage(name: string) {
    const pkg = packages.find((p) => p.name === name);
    if (!pkg) { setF("package_name", name); return; }
    const endDate = form.start_date && pkg.months > 0 ? addMonths(form.start_date, pkg.months) : "";
    setForm((f) => ({...f, package_name:name, price_idr:String(pkg.price), end_date:endDate}));
  }
  function pickStart(v: string) {
    const pkg = packages.find((p) => p.name === form.package_name);
    const endDate = v && pkg && pkg.months > 0 ? addMonths(v, pkg.months) : "";
    setForm((f) => ({...f, start_date:v, end_date:endDate}));
  }
  function openAdd() { setForm(emptyForm); setEditId(null); setMsg(""); setShowForm(true); }
  function openEdit(inv: Invoice) {
    setForm({ owner:inv.owner||"", store_name:inv.store_name||"", brand:inv.brand||"", package_name:inv.package_name, price_idr:String(inv.price_idr), start_date:inv.start_date, end_date:inv.end_date||"", notes:inv.notes||"" });
    setEditId(inv.id); setMsg(""); setShowForm(true);
  }
  async function save() {
    if (!form.package_name || !form.start_date) { setMsg("Package and Start Date are required."); return; }
    setSaving(true); setMsg("");
    const pkg = packages.find((p) => p.name === form.package_name);
    const payload = { client_id:clientId, owner:form.owner||null, brand:form.brand||null, store_name:form.store_name||null, package_name:form.package_name, package_type:pkg?.type||"addon", price_idr:Number(form.price_idr)||0, start_date:form.start_date, end_date:form.end_date||null, notes:form.notes||null };
    const { error } = editId
      ? await supabase.from("invoices").update({...payload, updated_at:new Date().toISOString()}).eq("id", editId)
      : await supabase.from("invoices").insert(payload);
    setSaving(false);
    if (error) { setMsg("✗ " + error.message); return; }
    setShowForm(false); setForm(emptyForm); setEditId(null); loadInvoices(clientId);
  }
  async function del(id: string) {
    if (!confirm("Delete this invoice?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    loadInvoices(clientId);
  }

  const activePkg = packages.find((p) => p.name === form.package_name);
  const isAddon   = activePkg?.type === "addon";

  const expiring = invoices.filter((inv) => {
    if (inv.package_type !== "subscription" || !inv.end_date) return false;
    const d = daysLeft(inv.end_date);
    return d >= 0 && d <= 30;
  });

  const pkgNames = Array.from(new Set(invoices.map((i) => i.package_name))).sort();
  const fOwners = Array.from(new Set(invoices.map((i) => i.owner).filter(Boolean) as string[])).sort();
  const shown = invoices.filter((inv) => {
    if (flt.owner && inv.owner !== flt.owner) return false;
    if (flt.package_name && inv.package_name !== flt.package_name) return false;
    if (flt.month) {
      const [y, mo] = flt.month.split("-").map(Number);
      const mStart = new Date(y, mo - 1, 1);
      const mEnd   = new Date(y, mo, 0); // last day of month
      const iStart = new Date(inv.start_date + "T00:00:00");
      const iEnd   = inv.end_date ? new Date(inv.end_date + "T00:00:00") : null;
      if (iStart > mEnd) return false;           // package starts after month
      if (iEnd && iEnd < mStart) return false;   // package ended before month
    }
    return true;
  });

  /* ── Render ── */
  return (
    <>
      {/* Expiry banner */}
      {expiring.length > 0 && (
        <div style={{ background:"rgba(245,158,11,.1)", border:"1px solid rgba(245,158,11,.3)", borderRadius:14, padding:"12px 16px", marginBottom:16 }}>
          <div style={{ fontWeight:800, color:"#fbbf24", fontSize:13, marginBottom:6 }}>⏰ {expiring.length} subscription{expiring.length>1?"s":""} expiring within 30 days</div>
          {expiring.map((inv) => { const d = daysLeft(inv.end_date!); return (
            <div key={inv.id} style={{ fontSize:12, color:"var(--text-2)", marginTop:4 }}>
              <span style={{ color:d<=7?"#f87171":"#fbbf24", fontWeight:700 }}>{d}d left</span>
              {" — "}{[inv.store_name, inv.owner].filter(Boolean).join(" / ")} · {inv.package_name} · ends {fmtDate(inv.end_date!)}
            </div>
          ); })}
        </div>
      )}

      <div className="panel">
        {/* ── Tabs ── */}
        <div style={{ display:"flex", gap:4, marginBottom:20, borderBottom:"1px solid rgba(255,255,255,0.08)", paddingBottom:0 }}>
          {(["invoices","products"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding:"9px 20px", borderRadius:"10px 10px 0 0", border:"none", cursor:"pointer", fontSize:13, fontWeight:600, transition:"all .15s",
                background: tab===t ? "rgba(201,162,39,0.12)" : "transparent",
                color: tab===t ? "#c9a227" : "var(--muted)",
                borderBottom: tab===t ? "2px solid #c9a227" : "2px solid transparent" }}>
              {t === "invoices" ? "Invoice List" : "Product Packages"}
            </button>
          ))}
        </div>

        {/* ══ TAB: Product Packages ══ */}
        {tab === "products" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div>
                <h3 style={{ margin:0 }}>Product Packages</h3>
                <div className="hint">Service packages offered by ProfTokoOnline</div>
              </div>
              <button className="btn-gold" onClick={openAddPkg}>+ New Package</button>
            </div>

            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>#</th><th>Package Name</th><th>Type</th><th>Duration</th><th className="num">Price</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {packages.map((p, i) => (
                    <tr key={p.id}>
                      <td style={{ color:"var(--muted)", fontSize:12 }}>{i+1}</td>
                      <td style={{ fontWeight:600 }}>{p.name}</td>
                      <td>
                        <span className={`pill ${p.type==="subscription"?"good":"warn"}`}>
                          {p.type === "subscription" ? "Subscription" : "Add-on"}
                        </span>
                      </td>
                      <td style={{ color:"var(--muted)", fontSize:13 }}>
                        {p.months > 0 ? `${p.months} bulan` : "One-time"}
                      </td>
                      <td className="num" style={{ fontWeight:600 }}>{fmtIDR(p.price)}</td>
                      <td>
                        <span className={`pill ${p.is_active?"good":"bad"}`}>{p.is_active?"Active":"Inactive"}</span>
                      </td>
                      <td>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={() => openEditPkg(p)} style={editBtn}>Edit</button>
                          <button onClick={() => deletePkg(p.id, p.name)} style={delBtn}>Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {packages.length === 0 && <tr><td colSpan={7} style={{ textAlign:"center", color:"var(--muted)", padding:28 }}>No packages yet</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══ TAB: Invoice List ══ */}
        {tab === "invoices" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12, marginBottom:14 }}>
              <div>
                <h3 style={{ margin:0 }}>Invoice List</h3>
                <div className="hint">Service packages per store.</div>
              </div>
              <button className="btn-gold" onClick={openAdd}>+ New Invoice</button>
            </div>

            {/* Filters */}
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginBottom:14 }}>
              <div className="fld" style={{ minWidth:160 }}>
                <label>Owner</label>
                <select value={flt.owner} onChange={(e) => setFlt((f) => ({...f, owner:e.target.value}))}>
                  <option value="">All owners</option>
                  {fOwners.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="fld" style={{ minWidth:180 }}>
                <label>Package</label>
                <select value={flt.package_name} onChange={(e) => setFlt((f) => ({...f, package_name:e.target.value}))}>
                  <option value="">All packages</option>
                  {pkgNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="fld" style={{ minWidth:160 }}>
                <label>Month</label>
                <input type="month" value={flt.month} onChange={(e) => setFlt((f) => ({...f, month:e.target.value}))}
                  style={{ padding:"7px 10px", borderRadius:10, border:"1px solid rgba(201,162,39,.25)", background:"rgba(10,22,40,.6)", color:"var(--text)", fontSize:13 }} />
              </div>
              {(flt.owner || flt.package_name || flt.month) && (
                <button className="btn-ghost" onClick={() => setFlt({owner:"",package_name:"",month:""})} style={{ height:38, alignSelf:"flex-end" }}>Reset</button>
              )}
              <span style={{ marginLeft:"auto", alignSelf:"flex-end", fontSize:11, fontWeight:700, color:"var(--gold)", background:"rgba(201,162,39,.12)", border:"1px solid rgba(201,162,39,.25)", borderRadius:999, padding:"3px 12px" }}>
                {shown.length} / {invoices.length}
              </span>
            </div>

            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Store</th><th>Owner</th><th>Brand</th><th>Package</th><th>Type</th><th className="num">Price</th><th>Start</th><th>End</th><th>Status</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {shown.map((inv) => {
                    const d = inv.end_date ? daysLeft(inv.end_date) : null;
                    const statusPill = inv.package_type==="addon"
                      ? <span className="pill warn">One-time</span>
                      : d===null ? null
                      : d<0  ? <span className="pill bad">Expired</span>
                      : d<=7 ? <span className="pill bad">{d}d</span>
                      : d<=30 ? <span className="pill warn">{d}d left</span>
                      : <span className="pill good">Active</span>;
                    return (
                      <tr key={inv.id}>
                        <td style={{ fontWeight:600 }}>{inv.store_name||"—"}</td>
                        <td>{inv.owner||"—"}</td>
                        <td>{inv.brand||"—"}</td>
                        <td>{inv.package_name}</td>
                        <td><span className={`pill ${inv.package_type==="subscription"?"good":"warn"}`}>{inv.package_type==="subscription"?"Sub":"Add-on"}</span></td>
                        <td className="num" style={{ whiteSpace:"nowrap" }}>{fmtIDR(inv.price_idr)}</td>
                        <td style={{ whiteSpace:"nowrap" }}>{fmtDate(inv.start_date)}</td>
                        <td style={{ whiteSpace:"nowrap" }}>{inv.end_date?fmtDate(inv.end_date):"—"}</td>
                        <td>{statusPill}</td>
                        <td style={{ maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--muted)", fontSize:12 }} title={inv.notes||""}>{inv.notes||"—"}</td>
                        <td>
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={() => openEdit(inv)} style={editBtn}>Edit</button>
                            <button onClick={() => del(inv.id)} style={delBtn}>Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={11} style={{ color:"var(--muted)", textAlign:"center", padding:28 }}>
                      {invoices.length ? "No invoices match these filters" : "No invoices yet — click New Invoice to add one"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ══ Modal: New/Edit Invoice ══ */}
      {showForm && typeof document !== "undefined" && createPortal(
        <div onClick={() => setShowForm(false)} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
            <div style={{ padding:"18px 20px 14px", borderBottom:"1px solid var(--line)", fontWeight:800, fontSize:16, color:"#fff" }}>
              {editId ? "Edit Invoice" : "New Invoice"}
            </div>

            <div style={{ padding:"16px 20px", overflowY:"auto", flex:1, display:"flex", flexDirection:"column", gap:14 }}>
              {msg && <div style={{ color:"#ff9a9a", fontSize:12, background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.2)", borderRadius:8, padding:"8px 12px" }}>{msg}</div>}

              {/* Row 1: Owner | Store Name | Brand — 3 columns */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                <MFld label="Owner">
                  <select value={form.owner} onChange={(e) => setF("owner", e.target.value)}>
                    <option value="">— Select —</option>
                    {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </MFld>
                <MFld label="Store Name">
                  <select value={form.store_name} onChange={(e) => {
                    const store = e.target.value;
                    const link = links.find((l) => l.store_name === store);
                    setForm((f) => ({ ...f, store_name:store, owner:link?.owner||f.owner, brand:link?.brand||f.brand }));
                  }}>
                    <option value="">— Select —</option>
                    {Array.from(new Set(links.map((l) => l.store_name).filter(Boolean) as string[])).sort().map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </MFld>
                <MFld label="Brand">
                  <select value={form.brand} onChange={(e) => setF("brand", e.target.value)}>
                    <option value="">— Select —</option>
                    {Array.from(new Set(links.map((l) => l.brand).filter(Boolean) as string[])).sort().map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </MFld>
              </div>

              {/* Package */}
              <MFld label="Package">
                <select value={form.package_name} onChange={(e) => pickPackage(e.target.value)}>
                  <option value="">— Select package —</option>
                  <optgroup label="── Subscriptions ──">
                    {packages.filter((p) => p.type==="subscription" && p.is_active).map((p) => (
                      <option key={p.id} value={p.name}>{p.name} — {fmtIDR(p.price)}</option>
                    ))}
                  </optgroup>
                  <optgroup label="── Add-ons (one-time) ──">
                    {packages.filter((p) => p.type==="addon" && p.is_active).map((p) => (
                      <option key={p.id} value={p.name}>{p.name} — {fmtIDR(p.price)}</option>
                    ))}
                  </optgroup>
                </select>
              </MFld>

              <MFld label="Price (IDR)">
                <input type="number" value={form.price_idr} onChange={(e) => setF("price_idr", e.target.value)} placeholder="Auto-filled from package" min="0" />
              </MFld>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <MFld label="Start Date">
                  <input type="date" value={form.start_date} onChange={(e) => pickStart(e.target.value)} />
                </MFld>
                <MFld label={isAddon ? "End Date (optional)" : "End Date (auto)"}>
                  <input type="date" value={form.end_date}
                    readOnly={!isAddon} disabled={!isAddon}
                    style={isAddon ? {} : { opacity:.65, cursor:"not-allowed" }}
                    onChange={isAddon ? (e) => setF("end_date", e.target.value) : undefined} />
                  {!isAddon && form.end_date && (
                    <span style={{ fontSize:10.5, color:"var(--muted)", marginTop:3 }}>{activePkg?.months}mo after start · {fmtDate(form.end_date)}</span>
                  )}
                </MFld>
              </div>

              <MFld label="Notes">
                <input type="text" value={form.notes} onChange={(e) => setF("notes", e.target.value)} placeholder="Optional note…" />
              </MFld>
            </div>

            <div style={{ padding:"12px 20px 16px", borderTop:"1px solid var(--line)", display:"flex", gap:10 }}>
              <button className="btn-gold" onClick={save} disabled={saving} style={{ flex:1 }}>{saving?"Saving…":editId?"Save Changes":"Create Invoice"}</button>
              <button className="btn-ghost" onClick={() => setShowForm(false)} style={{ flex:1 }}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══ Modal: New/Edit Package ══ */}
      {showPkgForm && typeof document !== "undefined" && createPortal(
        <div onClick={() => setShowPkgForm(false)} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, width:"min(94vw,420px)" }}>
            <div style={{ padding:"18px 20px 14px", borderBottom:"1px solid var(--line)", fontWeight:800, fontSize:16, color:"#fff" }}>
              {pkgEditId ? "Edit Package" : "New Package"}
            </div>

            <div style={{ padding:"16px 20px", display:"flex", flexDirection:"column", gap:14 }}>
              {pkgMsg && <div style={{ color:"#ff9a9a", fontSize:12, background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.2)", borderRadius:8, padding:"8px 12px" }}>{pkgMsg}</div>}

              <Fld2 label="Package Name">
                <input style={inp} value={pkgForm.name} onChange={(e) => setPkgForm((f) => ({...f, name:e.target.value}))} placeholder="e.g. Paket Lapak" />
              </Fld2>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Fld2 label="Type">
                  <select style={inp} value={pkgForm.type} onChange={(e) => setPkgForm((f) => ({...f, type:e.target.value, months:e.target.value==="addon"?0:3}))}>
                    <option value="subscription">Subscription</option>
                    <option value="addon">Add-on</option>
                  </select>
                </Fld2>
                <Fld2 label="Duration (months)">
                  <input style={inp} type="number" min="0" value={pkgForm.months}
                    disabled={pkgForm.type==="addon"}
                    placeholder={pkgForm.type==="addon"?"One-time":"e.g. 3"}
                    onChange={(e) => setPkgForm((f) => ({...f, months:Number(e.target.value)}))} />
                </Fld2>
              </div>

              <Fld2 label="Price (IDR)">
                <input style={inp} type="number" min="0" value={pkgForm.price} onChange={(e) => setPkgForm((f) => ({...f, price:Number(e.target.value)}))} />
              </Fld2>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Fld2 label="Sort Order">
                  <input style={inp} type="number" min="0" value={pkgForm.sort_order} onChange={(e) => setPkgForm((f) => ({...f, sort_order:Number(e.target.value)}))} />
                </Fld2>
                <Fld2 label="Status">
                  <select style={inp} value={pkgForm.is_active ? "1" : "0"} onChange={(e) => setPkgForm((f) => ({...f, is_active:e.target.value==="1"}))}>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </select>
                </Fld2>
              </div>
            </div>

            <div style={{ padding:"12px 20px 16px", borderTop:"1px solid var(--line)", display:"flex", gap:10 }}>
              <button className="btn-gold" onClick={savePkg} style={{ flex:1 }}>{pkgEditId?"Save Changes":"Add Package"}</button>
              <button className="btn-ghost" onClick={() => setShowPkgForm(false)} style={{ flex:1 }}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
