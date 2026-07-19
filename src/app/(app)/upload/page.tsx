"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DataSource } from "@/lib/parse";
import StoreSalesTable from "../StoreSalesTable";
import UploadHere from "./UploadHere";
import UploadLogTable from "./UploadLogTable";
import UploadIklan from "../ads/UploadIklan";
import FinanceUpload from "../product/FinanceUpload";
import StoreUpload from "../store/StoreUpload";
import { LEVELS } from "@/lib/adsConstants";
import { GUIDE } from "@/lib/uploadGuides";
import BrowseFile from "@/components/BrowseFile";
import { useLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// Card 1 — Store Performance (perf + spos). Card 2's "Ads Performa" slot
// lives in the same SLOTS/submit() mechanism (one shared multi-file
// dropzone + single upload button, same as before) — only the label and
// which card box a slot renders under changed.
const SLOTS: { source: DataSource; label: string; hint: string; accept: string }[] = [
  { source: "perf", label: "Store Performa", hint: "sales_overview", accept: ".xlsx,.xls,.csv" },
  { source: "spos", label: "Product Performa", hint: "parentskudetail", accept: ".xlsx,.xls,.csv" },
  { source: "ads",  label: "Ads Performa",     hint: "Data Keseluruhan Iklan", accept: ".xlsx,.xls,.csv" },
];
const CARD1_SOURCES: DataSource[] = ["perf", "spos"];
const GROUP_LEVELS = LEVELS.filter((l) => l.v !== "incubation");

const MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const WEEKS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];
const BASELINE_WEEK = "Baseline (Week 0)";

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

export default function UploadPage() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [manual, setManual] = useState({
    bulan: "", year: new Date().getFullYear(), week: "Week 1",
    pic_client: "", brand: "", store_name: "",
    tanggal_mulai: "", tanggal_berakhir: "",
  });
  // Explicit "+ New Brand/Store" toggles — strict dropdown of existing
  // values, or flip to free-text to create a new one.
  const [isNewBrand, setIsNewBrand] = useState(false);
  const [isNewStore, setIsNewStore] = useState(false);
  const inputTime = new Date();
  const [adminName, setAdminName] = useState("");
  const [clientId, setClientId] = useState("");
  // Card 3/4 (Finance / Ops) gate: staff roles always; an Owner only on an
  // active Sultan/King plan — mirrors the same check the upload routes
  // themselves enforce server-side (see /api/finance/upload's comment).
  const [role, setRole] = useState("");
  const [planType, setPlanType] = useState<string | null>(null);
  const [subEnd, setSubEnd] = useState<string | null>(null);

  const [owners, setOwners] = useState<string[]>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [links, setLinks] = useState<{ owner: string | null; brand: string | null; store_name: string | null }[]>([]);

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  // Bumped after a successful upload so <UploadLogTable> (which owns its
  // own uploads-list state) refetches.
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  // ---------- cascade handlers ----------
  function pickBulan(v: string) {
    if (v === "Baseline") {
      setManual((m) => ({ ...m, bulan: v, week: BASELINE_WEEK, tanggal_mulai: "", tanggal_berakhir: "" }));
    } else {
      setManual((m) => ({ ...m, bulan: v, week: m.week === BASELINE_WEEK ? "Week 1" : m.week }));
    }
  }
  function pickOwner(owner: string) { setIsNewBrand(false); setIsNewStore(false); setManual((m) => ({ ...m, pic_client: owner, brand: "", store_name: "" })); }
  function pickBrand(brand: string) { setIsNewStore(false); setManual((m) => ({ ...m, brand, store_name: "" })); }
  function pickStore(storeName: string) { setManual((m) => ({ ...m, store_name: storeName })); }
  function toggleNewBrand() {
    setManual((m) => ({ ...m, brand: "", store_name: "" }));
    setIsNewStore(false);
    setIsNewBrand((v) => !v);
  }
  function toggleNewStore() {
    if (!manual.brand) { alert(t("Please select or create a Brand first.")); return; }
    setManual((m) => ({ ...m, store_name: "" }));
    setIsNewStore((v) => !v);
  }
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
        supabase.from("profiles").select("display_name,email,role,client_id,plan_type,subscription_end").eq("id", user.id).single(),
        supabase.from("clients").select("id").order("created_at").limit(1),
      ]);
      const prof = p as { display_name: string | null; email: string | null; role: string; client_id: string | null; plan_type: string | null; subscription_end: string | null } | null;
      const name = prof?.display_name || user.email?.split("@")[0] || "Admin";
      setAdminName(name);
      setRole(prof?.role || "");
      setPlanType(prof?.plan_type ?? null);
      setSubEnd(prof?.subscription_end ?? null);
      // Owners are locked to their own tenant; staff (superadmin/client_admin/
      // advertiser) fall back to the first-created client (pre-existing
      // single-workspace assumption for staff, unchanged by this page).
      const cid = prof?.role === "branch_manager"
        ? (prof.client_id || "")
        : ((cs as { id: string }[])?.[0]?.id || "");
      setClientId(cid);
      reload(cid);
    })();
  }, [supabase, reload]);

  // Persist a brand/store the admin typed on the fly (select-or-create) so it
  // shows up in the dropdown next time. Idempotent via the store_links unique
  // index (migration 0087); admin's own session is RLS-permitted to write
  // (links_admin_all). No-op when the exact combo already exists.
  async function ensureStoreLink() {
    if (!clientId || !manual.pic_client || !manual.brand || !manual.store_name) return;
    const exists = links.some((l) => l.owner === manual.pic_client && l.brand === manual.brand && l.store_name === manual.store_name);
    if (exists) return;
    const row = { client_id: clientId, owner: manual.pic_client, brand: manual.brand, store_name: manual.store_name };
    await supabase.from("store_links").upsert(row, { onConflict: "client_id,owner,brand,store_name", ignoreDuplicates: true });
    setLinks((prev) => [...prev, { owner: row.owner, brand: row.brand, store_name: row.store_name }]);
  }

  async function submit() {
    setBusy(true); setLog([]);
    if (!clientId) { setLog([t("Workspace not ready.")]); setBusy(false); return; }
    if (!manual.year || !manual.bulan) { setLog([t("Year and Bulan are required.")]); setBusy(false); return; }
    const chosen = SLOTS.filter((s) => files[s.source]);
    if (!chosen.length) { setLog([t("Pick at least one file.")]); setBusy(false); return; }
    await ensureStoreLink();
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
    setLogRefreshKey((k) => k + 1);
  }

  const isBaseline = manual.bulan === "Baseline";

  // Card 3/4 gate: staff always; Owner only on an active Sultan/King plan —
  // mirrors what /api/finance/upload and /api/store/upload enforce server-side.
  const isOwner = role === "branch_manager";
  const canFinance = ["superadmin", "client_admin", "advertiser"].includes(role)
    || (isOwner && (planType === "sultan" || planType === "king")
        && (!subEnd || new Date(subEnd) > new Date()));

  // Two duplicate upload experiences: "Upload Here" (simplified — the only
  // one an Owner ever sees) and "Upload by Admin" (this page's original
  // full form — Admin/superadmin/advertiser). Superadmin gets both, as a
  // tab strip; everyone else gets whichever single one applies, no strip.
  const canAdminUpload = ["superadmin", "client_admin", "advertiser"].includes(role);
  const showTabStrip = isOwner ? false : (role === "superadmin");
  const [tab, setTab] = useState<"here" | "admin">(isOwner ? "here" : "admin");

  if (isOwner) return <UploadHere />;
  if (!canAdminUpload) return null;

  return (
    <>
      {showTabStrip && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => setTab("here")} style={uploadTabBtn(tab === "here")}>{t("Upload Here")}</button>
          <button onClick={() => setTab("admin")} style={uploadTabBtn(tab === "admin")}>{t("Upload by Admin")}</button>
        </div>
      )}
      {tab === "here" && showTabStrip && <UploadHere />}
      {(tab === "admin" || !showTabStrip) && <>
      {/* ───── Card 1 + 2: Store Performance / Ads Performance (All Level) ───── */}
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{t("Upload Shopee Data")}</h3>
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
        <div className="hint" style={{ marginBottom: 16 }}>{t("Attach one or more Shopee exports — Brand comes from your Owner → Brand → Store selection above.")}</div>

        {/* Row 1: Year · Month · Week */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label={t("Year")}>
            <input type="number" value={manual.year} onChange={(e) => setManual((m) => ({ ...m, year: Number(e.target.value) }))} />
          </Field>
          <Field label={t("Month")}>
            <select value={manual.bulan} onChange={(e) => pickBulan(e.target.value)}>
              <option value="">{t("Month")}</option>
              {MONTHS.map((m) => <option key={m}>{m}</option>)}
              <option value="Baseline">📌 Baseline (Month Awal)</option>
            </select>
          </Field>
          <Field label={t("Week")}>
            <select value={manual.week} onChange={(e) => setManual((m) => ({ ...m, week: e.target.value }))}>
              {WEEKS.map((w) => <option key={w}>{w}</option>)}
              <option value={BASELINE_WEEK}>📌 {BASELINE_WEEK}</option>
            </select>
          </Field>
        </div>

        {/* Row 2: Owner · Brand · Store Name (cascading) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
          <Field label={t("Owner")}>
            <select value={manual.pic_client} onChange={(e) => pickOwner(e.target.value)} disabled={!clientId}>
              <option value="">{t("Select owner…")}</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <div className="fld" style={{ minWidth: 0 }}>
            <div style={fieldHeader}>
              <label style={{ margin: 0 }}>{t("Brand")}</label>
              {manual.pic_client && <button type="button" onClick={toggleNewBrand} style={linkBtn}>{isNewBrand ? t("Cancel") : "+ " + t("New Brand")}</button>}
            </div>
            {isNewBrand
              ? <input type="text" value={manual.brand} placeholder={t("Type new brand…")} onChange={(e) => setManual((m) => ({ ...m, brand: e.target.value, store_name: "" }))} />
              : <select value={manual.brand} onChange={(e) => { if (e.target.value === NEW_OPTION) { toggleNewBrand(); return; } pickBrand(e.target.value); }} disabled={!manual.pic_client}>
                  <option value="">{manual.pic_client ? t("Select brand…") : t("Pick owner first")}</option>
                  {brandsForOwner.map((b) => <option key={b} value={b}>{b}</option>)}
                  <option value={NEW_OPTION} style={newOptionStyle}>{"+ " + t("New Brand")}</option>
                </select>}
          </div>
          <div className="fld" style={{ minWidth: 0 }}>
            <div style={fieldHeader}>
              <label style={{ margin: 0 }}>{t("Store Name")}</label>
              <button type="button" onClick={toggleNewStore} style={linkBtn}>{isNewStore ? t("Cancel") : "+ " + t("New Store")}</button>
            </div>
            {isNewStore
              ? <input type="text" value={manual.store_name} placeholder={t("Type new store…")} onChange={(e) => setManual((m) => ({ ...m, store_name: e.target.value }))} />
              : <select value={manual.store_name} onChange={(e) => { if (e.target.value === NEW_OPTION) { setIsNewStore(true); return; } pickStore(e.target.value); }} disabled={!manual.brand}>
                  <option value="">{manual.brand ? t("Select store…") : t("Pick brand first")}</option>
                  {storesForBrand.map((s) => <option key={s} value={s}>{s}</option>)}
                  {manual.brand && <option value={NEW_OPTION} style={newOptionStyle}>{"+ " + t("New Store")}</option>}
                </select>}
          </div>
        </div>

        {/* Row 3: 3 dates */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
          <Field label="Tanggal Mulai (Senin)">
            {isBaseline ? <BaselineDateBadge /> : <>
              <input type="date" value={manual.tanggal_mulai} onChange={(e) => pickStart(e.target.value)} />
              <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{t("Auto-snaps to Monday")} · {fmtID(manual.tanggal_mulai)}</span>
            </>}
          </Field>
          <Field label="Tanggal Akhir (Minggu)">
            {isBaseline ? <BaselineDateBadge /> : <>
              <input type="date" value={manual.tanggal_berakhir} readOnly disabled style={{ opacity: .7, cursor: "not-allowed" }} />
              <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{t("1 week after start")} · {fmtID(manual.tanggal_berakhir)}</span>
            </>}
          </Field>
          <Field label="Tanggal Input (log)">
            <input type="text" value={inputTime.toLocaleString("id-ID")} readOnly disabled style={{ opacity: .7, cursor: "not-allowed" }} />
            <span style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 3 }}>{t("Recorded automatically")}</span>
          </Field>
        </div>

        {/* Card 1: Store Performance — All Level */}
        <CardLabel title={t("Store Performance")} sub="All Level" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 20 }}>
          {SLOTS.filter((s) => CARD1_SOURCES.includes(s.source)).map((s) => (
            <BrowseFile key={s.source} label={s.label} hint={s.hint} file={files[s.source] ?? null}
              onPick={(f) => setFiles((prev) => ({ ...prev, [s.source]: f }))}
              guideImage={s.source === "perf" ? GUIDE.store : GUIDE.product} />
          ))}
        </div>

        {/* Card 2: Ads Performance — All Level */}
        <CardLabel title={t("Ads Performance")} sub="All Level" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", marginBottom: 14 }}>
          {SLOTS.filter((s) => s.source === "ads").map((s) => (
            <BrowseFile key={s.source} label={s.label} hint={s.hint} file={files[s.source] ?? null}
              onPick={(f) => setFiles((prev) => ({ ...prev, [s.source]: f }))}
              guideImage={GUIDE.ads} />
          ))}
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
          <button className="btn-gold" disabled={busy} onClick={submit} style={{ padding: "11px 40px", fontSize: 15 }}>
            {busy ? t("Uploading…") : t("Upload")}
          </button>
        </div>

        {log.length > 0 && (
          <div style={{ background: "rgba(7,13,26,.8)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, fontFamily: "monospace", fontSize: 12, marginTop: 16 }}>
            {log.map((l, i) => <div key={i} style={{ color: l.startsWith("✓") ? "var(--gold)" : "#f87171", marginBottom: 4 }}>{l}</div>)}
          </div>
        )}
      </div>

      {/* Card 2 continued: Inkubasi Performa + Group Performa — each is its
          own upload zone with its own Owner/Brand/Store/period (same as the
          Ads Performance page's identical widget), just narrowed to the
          ads_level(s) this card covers. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, marginTop: 18 }}>
        <UploadIklan
          clientId={clientId} supabase={supabase} onUploaded={() => setLogRefreshKey((k) => k + 1)}
          title="Inkubasi Performa" lockLevel="incubation"
          hint="Shopee Shop GMV Max / incubation export — one file per period."
        />
        <UploadIklan
          clientId={clientId} supabase={supabase} onUploaded={() => setLogRefreshKey((k) => k + 1)}
          title="Group Performa" levelChoices={GROUP_LEVELS}
          hint="Export one ad group (Hero / Independent / Low Conversion) per file."
        />
      </div>

      {/* Card 3 / 4: Finance Performa + Ops Performa — Sultan | King |
          Superadmin | Admin | Advertiser only (a Lapak Owner sees nothing
          here; the upload routes enforce the same gate server-side). */}
      {canFinance && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 18, marginTop: 18 }}>
          <div>
            <CardLabel title={t("Finance Detail")} sub="Sultan | King | Superadmin | Admin | Advertiser" />
            <FinanceUpload clientId={clientId} onUploaded={() => setLogRefreshKey((k) => k + 1)} />
          </div>
          <div>
            <CardLabel title={t("Operational Performance")} sub="Sultan | King | Superadmin | Admin | Advertiser" />
            <StoreUpload clientId={clientId} onUploaded={() => setLogRefreshKey((k) => k + 1)} />
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <StoreSalesTable />
      </div>

      <UploadLogTable clientId={clientId} refreshKey={logRefreshKey} />
      </>}
    </>
  );
}

function uploadTabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "9px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
    background: active ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
    color: active ? "var(--navy-deep)" : "#cdd9f0",
  };
}

const fieldHeader: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4, minHeight: 16 };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "var(--gold)", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0, whiteSpace: "nowrap" };
// Sentinel option value + gold styling for the "+ New Brand/Store" row
// pinned to the bottom of each dropdown's option list.
const NEW_OPTION = "__new__";
const newOptionStyle: React.CSSProperties = { color: "var(--gold)", fontWeight: 700 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fld" style={{ minWidth: 0 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function CardLabel({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--gold)" }}>{title}</span>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{sub}</span>
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
