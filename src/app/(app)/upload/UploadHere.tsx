"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MONTHS, WEEKS } from "@/lib/adsConstants";
import UploadLogTable from "./UploadLogTable";
import ImageGuideModal from "@/components/ImageGuideModal";

const GUIDE = {
  store: "/manuals/Data%20Performa%20Toko.jpg",
  product: "/manuals/Data%20Performa%20Produk.jpg",
  ads: "/manuals/Data%20Performa%20Iklan%20Total.jpg",
  finance: "/manuals/Data%20Penghasilan%20Dilepas.jpg",
  order: "/manuals/Data%20Order%20Selesai.jpg",
};

type Link = { owner: string | null; brand: string | null; store_name: string | null };
type Profile = { role: string; client_id: string | null; scope_owner: string | null };

// Simplified, self-serve upload for Owners (Lapak/Sultan/King) — superadmin
// can preview it too. Confirmed with the user before building:
//   1. No Week picker — the next open week (1-5) for the chosen store+month
//      is resolved automatically from what's already been uploaded.
//   2. Owner/Brand/Store auto-fill for an Owner login (they only ever
//      upload for their own scope); superadmin previewing this tab still
//      picks from the full cascade since they aren't scoped to one owner.
//   3. Five core files (Store Performa, Product Performa, Ads Performa,
//      GMV Auto/Inkubasi Performa, Group Ads Performa) are 5 explicit drop
//      zones sharing ONE Upload button — the user uploads all of them
//      together in one go. Each posts to its own known endpoint; no
//      content-sniffing (an earlier "auto-detect from 1 shared box" design
//      was replaced with this explicit 5-box layout).
//   4. Order Complete (Ops) + Finance Detail are a separate card, gated to
//      Sultan/King same as "Upload by Admin", each with its OWN independent
//      Browse+Upload — not part of the shared button above.
export default function UploadHere() {
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clientId, setClientId] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  // Bumped after any successful upload so <UploadLogTable> refetches.
  const [logRefreshKey, setLogRefreshKey] = useState(0);
  const [manual, setManual] = useState({ year: new Date().getFullYear(), bulan: "", pic_client: "", brand: "", store_name: "" });
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [adsFile, setAdsFile] = useState<File | null>(null);
  const [inkubasiFile, setInkubasiFile] = useState<File | null>(null);
  const [groupFile, setGroupFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // Order Complete / Finance Detail — independent of the 5-file form above.
  const [planType, setPlanType] = useState<string | null>(null);
  const [subEnd, setSubEnd] = useState<string | null>(null);
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderLog, setOrderLog] = useState("");
  const [financeFile, setFinanceFile] = useState<File | null>(null);
  const [financeBusy, setFinanceBusy] = useState(false);
  const [financeLog, setFinanceLog] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role,client_id,scope_owner,plan_type,subscription_end").eq("id", user.id).single();
      const prof = p as (Profile & { plan_type: string | null; subscription_end: string | null }) | null;
      setProfile(prof);
      setPlanType(prof?.plan_type ?? null);
      setSubEnd(prof?.subscription_end ?? null);
      const cid = prof?.role === "branch_manager" ? prof.client_id : null;
      // Superadmin previewing this tab isn't scoped to one client — fall
      // back to the first-created client, same convention used elsewhere.
      const resolvedCid = cid || (await supabase.from("clients").select("id").order("created_at").limit(1)).data?.[0]?.id || "";
      setClientId(resolvedCid);
      const { data: sl } = await supabase.from("store_links").select("owner,brand,store_name").eq("client_id", resolvedCid).order("created_at");
      let linkData = (sl as Link[]) || [];
      if (prof?.role === "branch_manager") linkData = linkData.filter((l) => l.owner === prof.scope_owner);
      setLinks(linkData);
      if (prof?.role === "branch_manager") {
        const brands = Array.from(new Set(linkData.map((l) => l.brand).filter(Boolean) as string[]));
        const stores = Array.from(new Set(linkData.map((l) => l.store_name).filter(Boolean) as string[]));
        setManual((m) => ({
          ...m,
          pic_client: prof.scope_owner || "",
          brand: brands.length === 1 ? brands[0] : "",
          store_name: stores.length === 1 ? stores[0] : "",
        }));
      }
    })();
  }, [supabase]);

  const isOwnerLogin = profile?.role === "branch_manager";
  const owners = Array.from(new Set(links.map((l) => l.owner).filter(Boolean) as string[])).sort();
  const brandsForOwner = manual.pic_client
    ? Array.from(new Set(links.filter((l) => l.owner === manual.pic_client).map((l) => l.brand).filter(Boolean) as string[])).sort()
    : Array.from(new Set(links.map((l) => l.brand).filter(Boolean) as string[])).sort();
  const storesForBrand = manual.brand
    ? links.filter((l) => l.brand === manual.brand && (!manual.pic_client || l.owner === manual.pic_client)).map((l) => l.store_name).filter(Boolean) as string[]
    : [];

  // Auto-fill only locks a field when the owner has exactly one option —
  // otherwise they still pick, just from a list narrowed to their own scope.
  const brandLocked = isOwnerLogin && brandsForOwner.length === 1;
  const storeLocked = isOwnerLogin && storesForBrand.length === 1;

  async function resolveNextWeek(cid: string, store: string, month: string): Promise<string> {
    const { data } = await supabase.from("sales_rows")
      .select("week").eq("client_id", cid).eq("store_name", store).eq("month", month).not("week", "is", null);
    const used = new Set((data || []).map((r) => (r as { week: string }).week));
    return WEEKS.find((w) => !used.has(w)) || WEEKS[WEEKS.length - 1];
  }

  async function submit() {
    if (!manual.year || !manual.bulan) { setLog(["Year and Bulan are required."]); return; }
    if (!manual.store_name) { setLog(["Select Owner → Brand → Store."]); return; }
    if (!storeFile && !productFile && !adsFile && !inkubasiFile && !groupFile) { setLog(["Pick at least one file."]); return; }

    if (!clientId) { setLog(["Workspace not ready."]); return; }
    setBusy(true); setLog([]);
    const resolvedCid = clientId;

    const week = await resolveNextWeek(resolvedCid, manual.store_name, manual.bulan);
    const manualToSend = { ...manual, week, tanggal_input: new Date().toISOString() };
    const results: string[] = [];

    async function postCore(source: "perf" | "spos" | "ads", file: File) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("source", source);
      fd.append("client_id", resolvedCid);
      fd.append("manual", JSON.stringify(manualToSend));
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      return { ok: res.ok, j };
    }

    async function postGroup(file: File, adsLevel: string | null) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("client_id", resolvedCid);
      fd.append("manual", JSON.stringify(adsLevel ? { ...manualToSend, ads_level: adsLevel } : manualToSend));
      const res = await fetch("/api/ads-group/upload", { method: "POST", body: fd });
      const j = await res.json();
      return { ok: res.ok, j };
    }

    if (storeFile) {
      const { ok, j } = await postCore("perf", storeFile);
      results.push(ok ? `✓ Store Performa: ${j.rows} rows` : `✗ Store Performa: ${j.error}`);
    }
    if (productFile) {
      const { ok, j } = await postCore("spos", productFile);
      results.push(ok ? `✓ Product Performa: ${j.rows} rows` : `✗ Product Performa: ${j.error}`);
    }
    if (adsFile) {
      const { ok, j } = await postCore("ads", adsFile);
      results.push(ok ? `✓ Ads Performa: ${j.rows} rows` : `✗ Ads Performa: ${j.error}`);
    }
    if (inkubasiFile) {
      const { ok, j } = await postGroup(inkubasiFile, "incubation");
      results.push(ok ? `✓ GMV Auto Performa: ${j.rows} rows` : `✗ GMV Auto Performa: ${j.error}`);
    }
    if (groupFile) {
      const { ok, j } = await postGroup(groupFile, null);
      results.push(ok ? `✓ Group Ads Performa: ${j.rows} rows` : `✗ Group Ads Performa: ${j.error}`);
    }

    setLog(results);
    if (results.some((r) => r.startsWith("✓"))) {
      setStoreFile(null); setProductFile(null); setAdsFile(null); setInkubasiFile(null); setGroupFile(null);
      setLogRefreshKey((k) => k + 1);
    }
    setBusy(false);
  }

  async function submitOrder() {
    if (!clientId || !orderFile || !manual.store_name) return;
    if (!manual.year || !manual.bulan) { setOrderLog("✗ Year and Bulan are required."); return; }
    setOrderBusy(true); setOrderLog("");
    const fd = new FormData();
    fd.append("file", orderFile);
    fd.append("client_id", clientId);
    fd.append("manual", JSON.stringify({ year: manual.year, bulan: manual.bulan, pic_client: manual.pic_client, brand: manual.brand, store_name: manual.store_name }));
    try {
      const res = await fetch("/api/store/upload", { method: "POST", body: fd });
      const j = await res.json();
      setOrderLog(res.ok ? `✓ ${j.rows} rows` : `✗ ${j.error}`);
      if (res.ok) setOrderFile(null);
    } catch (e) { setOrderLog("✗ " + String(e)); }
    setOrderBusy(false);
  }

  async function submitFinance() {
    if (!clientId || !financeFile || !manual.store_name) return;
    if (!manual.year || !manual.bulan) { setFinanceLog("✗ Year and Bulan are required."); return; }
    setFinanceBusy(true); setFinanceLog("");
    const fd = new FormData();
    fd.append("file", financeFile);
    fd.append("client_id", clientId);
    fd.append("manual", JSON.stringify({ year: manual.year, bulan: manual.bulan, pic_client: manual.pic_client, brand: manual.brand, store_name: manual.store_name }));
    try {
      const res = await fetch("/api/finance/upload", { method: "POST", body: fd });
      const j = await res.json();
      setFinanceLog(res.ok ? `✓ ${j.rows} rows` : `✗ ${j.error}`);
      if (res.ok) setFinanceFile(null);
    } catch (e) { setFinanceLog("✗ " + String(e)); }
    setFinanceBusy(false);
  }

  const canFinance = !isOwnerLogin || ((planType === "sultan" || planType === "king")
    && (!subEnd || new Date(subEnd) > new Date()));

  return (
    <>
    <div className="panel">
      <h3 style={{ margin: 0 }}>Upload Shopee Data</h3>
      <div className="hint" style={{ marginBottom: 16 }}>Pick the month, confirm your store, and drop your Shopee exports — the week is filled in automatically.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, marginBottom: 20 }}>
        <F label="Year"><input type="number" value={manual.year} onChange={(e) => setManual((m) => ({ ...m, year: Number(e.target.value) }))} /></F>
        <F label="Bulan">
          <select value={manual.bulan} onChange={(e) => setManual((m) => ({ ...m, bulan: e.target.value }))}>
            <option value="">Month</option>
            {MONTHS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </F>
        <F label="Owner">
          {isOwnerLogin
            ? <ReadonlyField value={manual.pic_client || "—"} />
            : <select value={manual.pic_client} onChange={(e) => setManual((m) => ({ ...m, pic_client: e.target.value, brand: "", store_name: "" }))}>
                <option value="">Select owner…</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>}
        </F>
        <F label="Brand">
          {brandLocked
            ? <ReadonlyField value={manual.brand} />
            : <select value={manual.brand} onChange={(e) => setManual((m) => ({ ...m, brand: e.target.value, store_name: "" }))} disabled={!manual.pic_client}>
                <option value="">{manual.pic_client ? "Select brand…" : "Owner first"}</option>
                {brandsForOwner.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>}
        </F>
        <F label="Store">
          {storeLocked
            ? <ReadonlyField value={manual.store_name} />
            : <select value={manual.store_name} onChange={(e) => setManual((m) => ({ ...m, store_name: e.target.value }))} disabled={!manual.brand}>
                <option value="">{manual.brand ? "Select store…" : "Brand first"}</option>
                {storesForBrand.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>}
        </F>
      </div>

      <CardLabel title="Store Performance" sub="All Level" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 20, alignItems: "start" }}>
        <BrowseFile label="Store Performa" hint="sales_overview" file={storeFile} onPick={setStoreFile} guideImage={GUIDE.store} />
        <BrowseFile label="Product Performa" hint="parentskudetail" file={productFile} onPick={setProductFile} guideImage={GUIDE.product} />
      </div>

      <CardLabel title="Ads Performance" sub="All Level" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20, alignItems: "start" }}>
        <BrowseFile label="Ads Performa" hint="Data Keseluruhan Iklan" file={adsFile} onPick={setAdsFile} guideImage={GUIDE.ads} />
        <BrowseFile label="GMV Auto Performa" hint="Inkubasi" file={inkubasiFile} onPick={setInkubasiFile} guideImage={GUIDE.ads} />
        <BrowseFile label="Group Ads Performa" hint="Grup Iklan" file={groupFile} onPick={setGroupFile} guideImage={GUIDE.ads} />
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

      {canFinance && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 8 }}>
            <CardLabel title="Order Complete" sub="Sultan | King" />
            <CardLabel title="Finance Detail" sub="Sultan | King" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, alignItems: "start" }}>
            <div>
              <BrowseFile label="Order Complete" hint="OrderCompleted.xlsx" file={orderFile} onPick={setOrderFile} guideImage={GUIDE.order} />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <button className="btn-gold" disabled={orderBusy || !orderFile} onClick={submitOrder} style={{ padding: "9px 30px", fontSize: 13.5 }}>
                  {orderBusy ? "Uploading…" : "Upload"}
                </button>
                {orderLog && <span style={{ fontSize: 12, fontFamily: "monospace", color: orderLog.startsWith("✓") ? "var(--gold)" : "#f87171" }}>{orderLog}</span>}
              </div>
            </div>
            <div>
              <BrowseFile label="Finance Detail" hint="IncomeDilepas.xlsx" file={financeFile} onPick={setFinanceFile} guideImage={GUIDE.finance} />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <button className="btn-gold" disabled={financeBusy || !financeFile} onClick={submitFinance} style={{ padding: "9px 30px", fontSize: 13.5 }}>
                  {financeBusy ? "Uploading…" : "Upload"}
                </button>
                {financeLog && <span style={{ fontSize: 12, fontFamily: "monospace", color: financeLog.startsWith("✓") ? "var(--gold)" : "#f87171" }}>{financeLog}</span>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    <UploadLogTable clientId={clientId} refreshKey={logRefreshKey} />
    </>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld" style={{ minWidth: 0 }}><label>{label}</label>{children}</div>;
}

function ReadonlyField({ value }: { value: string }) {
  return (
    <div style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "rgba(255,255,255,.03)", color: "#cdd9f0", fontSize: 13.5, minHeight: 38, display: "flex", alignItems: "center" }}>
      {value || "—"}
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

// Native file inputs render as "Choose File / No file chosen" with no way
// to restyle the button portion cross-browser — so the real input is
// visually hidden and triggered by a styled button instead.
function BrowseFile({ label, hint, file, onPick, guideImage }: {
  label: string; hint: string; file: File | null; onPick: (f: File | null) => void; guideImage?: string;
}) {
  const inputId = `browse-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{ padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)", display: "flex", flexDirection: "column" }}>
      <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600, display: "block", marginBottom: 10 }}>
        {label} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>({hint})</span>
      </label>
      <input id={inputId} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <label htmlFor={inputId} className="btn-ghost" style={{ display: "inline-block", padding: "8px 20px", cursor: "pointer", fontSize: 12.5, alignSelf: "flex-start" }}>
        Browse File
      </label>
      <span style={{ marginTop: 8, fontSize: 11.5, color: file ? "var(--gold)" : "var(--muted)" }}>
        {file ? `✓ ${file.name}` : "No file chosen"}
      </span>
      {guideImage && (
        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <ImageGuideModal image={guideImage} />
        </div>
      )}
    </div>
  );
}
