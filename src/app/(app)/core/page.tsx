"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Item = { id: string; kind: string; value: string; pic: string | null; city: string | null };
type LinkRow = { owner: string | null; brand: string | null; store_name: string | null };

export default function CoreListPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [msg, setMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); setLinks([]); return; }
    const [{ data: itemData }, { data: linkData }] = await Promise.all([
      supabase.from("master_data").select("id,kind,value,pic,city").eq("client_id", cid).order("value"),
      supabase.from("store_links").select("owner,brand,store_name").eq("client_id", cid),
    ]);
    setItems((itemData as Item[]) || []);
    setLinks((linkData as LinkRow[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      const initial = (cs as { id: string }[])?.[0]?.id || "";
      setClientId(initial);
      reload(initial);
    })();
  }, [supabase, reload]);

  const cities    = items.filter((i) => i.kind === "city");
  const owners    = items.filter((i) => i.kind === "owner");
  const brands    = items.filter((i) => i.kind === "brand");
  const stores    = items.filter((i) => i.kind === "store");
  const platforms = items.filter((i) => i.kind === "platform");

  // Derived relationships from store_links
  const brandsForOwner = (owner: string) =>
    Array.from(new Set(links.filter((l) => l.owner === owner).map((l) => l.brand).filter(Boolean))) as string[];
  const ownerOfBrand = (brand: string) =>
    links.find((l) => l.brand === brand)?.owner || null;
  const brandOfStore = (store: string) =>
    links.find((l) => l.store_name === store)?.brand || null;
  const ownerOfStore = (store: string) =>
    links.find((l) => l.store_name === store)?.owner || null;

  async function insertMD(row: Record<string, unknown>): Promise<boolean> {
    if (!clientId) { setMsg("Workspace not ready — refresh"); return false; }
    setMsg("");
    const { error } = await supabase.from("master_data").insert({ client_id: clientId, ...row });
    if (error) { setMsg(error.code === "23505" ? `"${row.value}" already exists` : "✗ " + error.message); return false; }
    return true;
  }

  async function addCity(city: string, pic: string) {
    if (await insertMD({ kind: "city", value: city, pic: pic || null })) reload(clientId);
  }
  async function addOwner(name: string) {
    if (await insertMD({ kind: "owner", value: name })) reload(clientId);
  }
  async function addBrand(brand: string, owner: string) {
    if (!owner) { setMsg("✗ Select an owner first"); return; }
    const ok = await insertMD({ kind: "brand", value: brand });
    if (!ok) return;
    await supabase.from("store_links").insert({ client_id: clientId, owner, brand, store_name: null });
    reload(clientId);
  }
  async function addStore(storeName: string, brand: string) {
    if (!brand) { setMsg("✗ Select a brand first"); return; }
    const owner = ownerOfBrand(brand);
    const ok = await insertMD({ kind: "store", value: storeName });
    if (!ok) return;
    await supabase.from("store_links").insert({ client_id: clientId, owner, brand, store_name: storeName });
    reload(clientId);
  }
  async function addPlatform(value: string) {
    if (await insertMD({ kind: "platform", value })) reload(clientId);
  }

  async function delItem(id: string, kind: string, value: string) {
    if (kind === "owner") await supabase.from("store_links").delete().eq("client_id", clientId).eq("owner", value);
    if (kind === "brand") await supabase.from("store_links").delete().eq("client_id", clientId).eq("brand", value);
    if (kind === "store") await supabase.from("store_links").delete().eq("client_id", clientId).eq("store_name", value);
    await supabase.from("master_data").delete().eq("id", id);
    reload(clientId);
  }

  async function syncFromUploads() {
    setSyncing(true); setMsg("");
    try {
      const res = await fetch("/api/core/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) setMsg("✗ " + (json.error || res.statusText));
      else { setMsg(`✓ Synced ${json.stores} stores across ${json.clients} client(s).`); reload(clientId); }
    } catch (e) { setMsg("✗ " + String(e)); }
    finally { setSyncing(false); }
  }

  const isOk = msg.startsWith("✓");

  return (
    <>
      {msg && (
        <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 12px", borderRadius: 10,
          color: isOk ? "#86efac" : "#ff9a9a",
          background: isOk ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)",
          border: isOk ? "1px solid rgba(34,197,94,.2)" : "1px solid rgba(239,68,68,.2)" }}>
          {msg}
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Core List</h3>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Master reference data — Owner → Brand → Store hierarchy, City, Platform. Used by Upload, dashboard filters, and invite forms.
          </div>
        </div>
        <button onClick={syncFromUploads} disabled={syncing}
          style={{ flexShrink: 0, padding: "9px 18px", borderRadius: 10, border: "none",
            cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.7 : 1, whiteSpace: "nowrap",
            background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)", fontWeight: 700, fontSize: 13 }}>
          {syncing ? "Syncing…" : "⟳ Sync from Uploads"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr 1.4fr 1fr", gap: 16, alignItems: "start" }}>

        {/* Card 1: City */}
        <Card icon="🏙️" title="City" hint="used in upload & filters" count={cities.length}>
          <PlainList items={cities} onDel={(id, val) => delItem(id, "city", val)} />
          <CityAdd onAdd={addCity} />
        </Card>

        {/* Card 2: Owner & Brand */}
        <Card icon="👤" title="Owner & Brand" hint="1 owner → many brands · 1 brand → 1 owner" count={owners.length + brands.length}>
          <OwnerBrandTree
            owners={owners}
            brandsForOwner={brandsForOwner}
            allBrands={brands}
            onDelOwner={(id, val) => delItem(id, "owner", val)}
            onDelBrand={(id, val) => delItem(id, "brand", val)}
          />
          <OwnerBrandAdd ownersList={owners.map((o) => o.value)} onAddOwner={addOwner} onAddBrand={addBrand} />
        </Card>

        {/* Card 3: Store */}
        <Card icon="🏬" title="Store" hint="1 store → 1 brand · 1 brand → 1 owner" count={stores.length}>
          <StoreList stores={stores} brandOfStore={brandOfStore} ownerOfStore={ownerOfStore} onDel={(id, val) => delItem(id, "store", val)} />
          <StoreAdd brandsList={brands.map((b) => b.value)} onAdd={addStore} />
        </Card>

        {/* Card 4: Platform */}
        <Card icon="📦" title="Platform" hint="e.g. Shopee, Tokopedia" count={platforms.length}>
          <PlainList items={platforms} onDel={(id, val) => delItem(id, "platform", val)} />
          <SimpleAdd placeholder="Add platform" onAdd={addPlatform} />
        </Card>
      </div>
    </>
  );
}

/* ─── shared card wrapper ─── */
function Card({ icon, title, hint, count, children }: { icon: string; title: string; hint?: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          {hint && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{hint}</div>}
        </div>
        <CountBadge n={count} />
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>{children}</div>
    </div>
  );
}

/* ─── plain list (City, Platform) ─── */
function PlainList({ items, onDel }: { items: { id: string; value: string }[]; onDel: (id: string, val: string) => void }) {
  if (!items.length) return <Empty />;
  return (
    <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((i) => (
        <RowItem key={i.id} main={i.value} onDel={() => onDel(i.id, i.value)} />
      ))}
    </div>
  );
}

/* ─── owner → brand tree ─── */
function OwnerBrandTree({
  owners, brandsForOwner, allBrands, onDelOwner, onDelBrand,
}: {
  owners: { id: string; value: string }[];
  brandsForOwner: (o: string) => string[];
  allBrands: { id: string; value: string }[];
  onDelOwner: (id: string, val: string) => void;
  onDelBrand: (id: string, val: string) => void;
}) {
  if (!owners.length && !allBrands.length) return <Empty />;
  const ownersWithBrands = owners.map((o) => ({ owner: o, brands: brandsForOwner(o.value) }));
  // Brands not yet linked to any owner
  const linkedBrands = new Set(ownersWithBrands.flatMap((o) => o.brands));
  const unlinked = allBrands.filter((b) => !linkedBrands.has(b.value));
  return (
    <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      {ownersWithBrands.map(({ owner, brands }) => (
        <div key={owner.id} style={{ background: "rgba(10,22,40,.45)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: brands.length ? "1px solid var(--line)" : "none" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)" }}>OWNER</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{owner.value}</span>
            <DelBtn onClick={() => onDelOwner(owner.id, owner.value)} />
          </div>
          {brands.map((bName) => {
            const bItem = allBrands.find((b) => b.value === bName);
            return (
              <div key={bName} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 28px" }}>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>🏷️</span>
                <span style={{ flex: 1, fontSize: 13 }}>{bName}</span>
                {bItem && <DelBtn onClick={() => onDelBrand(bItem.id, bItem.value)} />}
              </div>
            );
          })}
        </div>
      ))}
      {unlinked.map((b) => (
        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.3)", border: "1px dashed var(--line)", borderRadius: 10, padding: "7px 12px" }}>
          <span style={{ fontSize: 10 }}>🏷️</span>
          <span style={{ flex: 1, fontSize: 13 }}>{b.value}</span>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>no owner</span>
          <DelBtn onClick={() => onDelBrand(b.id, b.value)} />
        </div>
      ))}
    </div>
  );
}

function OwnerBrandAdd({ ownersList, onAddOwner, onAddBrand }: { ownersList: string[]; onAddOwner: (n: string) => void; onAddBrand: (b: string, o: string) => void }) {
  const [ownerVal, setOwnerVal] = useState("");
  const [brandVal, setBrandVal] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const goOwner = () => { if (ownerVal.trim()) { onAddOwner(ownerVal.trim()); setOwnerVal(""); } };
  const goBrand = () => { if (brandVal.trim() && selectedOwner) { onAddBrand(brandVal.trim(), selectedOwner); setBrandVal(""); } };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={{ ...fieldStyle, flex: 1 }} placeholder="Add owner name" value={ownerVal}
          onChange={(e) => setOwnerVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && goOwner()} />
        <button style={plusStyle} onClick={goOwner}>+</button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select style={{ ...fieldStyle, flex: "0 0 auto", width: "auto", minWidth: 110 }} value={selectedOwner} onChange={(e) => setSelectedOwner(e.target.value)}>
          <option value="">Owner ▾</option>
          {ownersList.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input style={{ ...fieldStyle, flex: 1 }} placeholder="Add brand name" value={brandVal}
          onChange={(e) => setBrandVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && goBrand()} />
        <button style={plusStyle} onClick={goBrand}>+</button>
      </div>
    </div>
  );
}

/* ─── store list ─── */
function StoreList({ stores, brandOfStore, ownerOfStore, onDel }: {
  stores: { id: string; value: string }[];
  brandOfStore: (s: string) => string | null;
  ownerOfStore: (s: string) => string | null;
  onDel: (id: string, val: string) => void;
}) {
  if (!stores.length) return <Empty />;
  return (
    <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      {stores.map((s) => {
        const brand = brandOfStore(s.value);
        const owner = ownerOfStore(s.value);
        return (
          <div key={s.id} style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{s.value}</div>
              {(brand || owner) && (
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {[brand, owner].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            <DelBtn onClick={() => onDel(s.id, s.value)} />
          </div>
        );
      })}
    </div>
  );
}

function StoreAdd({ brandsList, onAdd }: { brandsList: string[]; onAdd: (name: string, brand: string) => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const go = () => { if (name.trim() && brand) { onAdd(name.trim(), brand); setName(""); } };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={{ ...fieldStyle, flex: 1 }} placeholder="Store name" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button style={plusStyle} onClick={go}>+</button>
      </div>
      <select style={{ ...fieldStyle, width: "100%" }} value={brand} onChange={(e) => setBrand(e.target.value)}>
        <option value="">Select brand ▾</option>
        {brandsList.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    </div>
  );
}

/* ─── city add ─── */
function CityAdd({ onAdd }: { onAdd: (c: string, pic: string) => void }) {
  const [city, setCity] = useState(""); const [pic, setPic] = useState("");
  const go = () => { if (city.trim()) { onAdd(city.trim(), pic.trim()); setCity(""); setPic(""); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 40px", gap: 8, marginTop: "auto" }}>
      <input style={fieldStyle} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <input style={fieldStyle} placeholder="PIC (optional)" value={pic} onChange={(e) => setPic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

/* ─── simple add ─── */
function SimpleAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v.trim()); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, flex: 1 }} placeholder={placeholder} value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

/* ─── tiny helpers ─── */
function RowItem({ main, sub, onDel }: { main: string; sub?: string | null; onDel: () => void }) {
  return (
    <div style={rowStyle}>
      <span style={{ flex: 1, fontSize: 13 }}>{main}{sub ? <span style={{ color: "var(--muted)" }}> — {sub}</span> : null}</span>
      <DelBtn onClick={onDel} />
    </div>
  );
}
function Empty() { return <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "10px 4px", textAlign: "center" }}>No entries yet</div>; }
function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Remove"
      style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#ff9a9a")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}>×</button>
  );
}
function CountBadge({ n }: { n: number }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "2px 10px" }}>{n}</span>;
}

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" };
const fieldStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13, outline: "none", minWidth: 0 };
const plusStyle: React.CSSProperties = { flexShrink: 0, width: 40, borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)", fontWeight: 800, fontSize: 18 };
