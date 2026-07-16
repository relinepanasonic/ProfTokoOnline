"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MONTHS, WEEKS } from "@/lib/adsConstants";

type Link = { owner: string | null; brand: string | null; store_name: string | null };
type Profile = { role: string; client_id: string | null; scope_owner: string | null };

// Simplified, self-serve upload for Owners (Lapak/Sultan/King) — superadmin
// can preview it too. Three deliberate simplifications over "Upload by
// Admin", each confirmed with the user before building:
//   1. No Week picker — the next open week (1-5) for the chosen store+month
//      is resolved automatically from what's already been uploaded.
//   2. Owner/Brand/Store auto-fill for an Owner login (they only ever
//      upload for their own scope); superadmin previewing this tab still
//      picks from the full cascade since they aren't scoped to one owner.
//   3. Ads Performa / Inkubasi Performa / Group Performa collapse into ONE
//      drop zone + one button — /api/upload/ads-auto sniffs the file's
//      title row to route it to the right table automatically.
export default function UploadHere() {
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clientId, setClientId] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [manual, setManual] = useState({ year: new Date().getFullYear(), bulan: "", pic_client: "", brand: "", store_name: "" });
  const [storeFile, setStoreFile] = useState<File | null>(null);
  const [productFile, setProductFile] = useState<File | null>(null);
  const [adsFile, setAdsFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role,client_id,scope_owner").eq("id", user.id).single();
      const prof = p as Profile | null;
      setProfile(prof);
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
    if (!manual.bulan) { setLog(["Pick the month."]); return; }
    if (!manual.store_name) { setLog(["Select Owner → Brand → Store."]); return; }
    if (!storeFile && !productFile && !adsFile) { setLog(["Pick at least one file."]); return; }

    if (!clientId) { setLog(["Workspace not ready."]); return; }
    setBusy(true); setLog([]);
    const resolvedCid = clientId;

    const week = await resolveNextWeek(resolvedCid, manual.store_name, manual.bulan);
    const manualToSend = { ...manual, week, tanggal_input: new Date().toISOString() };
    const results: string[] = [];

    async function postCore(source: "perf" | "spos", file: File) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("source", source);
      fd.append("client_id", resolvedCid);
      fd.append("manual", JSON.stringify(manualToSend));
      const res = await fetch("/api/upload", { method: "POST", body: fd });
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
      const fd = new FormData();
      fd.append("file", adsFile);
      fd.append("client_id", resolvedCid);
      fd.append("manual", JSON.stringify(manualToSend));
      const res = await fetch("/api/upload/ads-auto", { method: "POST", body: fd });
      const j = await res.json();
      const typeLabel = j.type === "incubation" ? "Inkubasi Performa" : j.type === "group" ? "Group Performa" : "Ads Performa";
      results.push(res.ok ? `✓ ${typeLabel}: ${j.rows} rows` : `✗ Ads Performa: ${j.error}`);
    }

    setLog(results);
    if (results.some((r) => r.startsWith("✓"))) { setStoreFile(null); setProductFile(null); setAdsFile(null); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h3 style={{ margin: 0 }}>Upload Shopee Data</h3>
      <div className="hint" style={{ marginBottom: 16 }}>Pick the month, confirm your store, and drop your Shopee exports — the week is filled in automatically.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 14 }}>
        <F label="Year"><input type="number" value={manual.year} onChange={(e) => setManual((m) => ({ ...m, year: Number(e.target.value) }))} /></F>
        <F label="Bulan">
          <select value={manual.bulan} onChange={(e) => setManual((m) => ({ ...m, bulan: e.target.value }))}>
            <option value="">Month</option>
            {MONTHS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </F>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 14, marginBottom: 20 }}>
        <BrowseFile label="Store Performa" hint="sales_overview" file={storeFile} onPick={setStoreFile} />
        <BrowseFile label="Product Performa" hint="parentskudetail" file={productFile} onPick={setProductFile} />
      </div>

      <CardLabel title="Ads Performance" sub="All Level" />
      <div style={{ marginBottom: 20 }}>
        <BrowseFile label="Ads Performa" hint="Ads, Inkubasi, or Group — detected automatically" file={adsFile} onPick={setAdsFile} />
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
function BrowseFile({ label, hint, file, onPick }: {
  label: string; hint: string; file: File | null; onPick: (f: File | null) => void;
}) {
  const inputId = `browse-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{ padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)" }}>
      <label style={{ fontSize: 12, color: "#cdd9f0", fontWeight: 600, display: "block", marginBottom: 10 }}>
        {label} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 11 }}>({hint})</span>
      </label>
      <input id={inputId} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      <label htmlFor={inputId} className="btn-ghost" style={{ display: "inline-block", padding: "8px 20px", cursor: "pointer", fontSize: 12.5 }}>
        Browse File
      </label>
      <span style={{ marginLeft: 12, fontSize: 11.5, color: file ? "var(--gold)" : "var(--muted)" }}>
        {file ? `✓ ${file.name}` : "No file chosen"}
      </span>
    </div>
  );
}
