"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

  const ownerOfBrand = (brand: string) => links.find((l) => l.brand === brand && !l.store_name)?.owner || null;
  const brandOfStore = (store: string) => links.find((l) => l.store_name === store)?.brand || null;

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
    const ok = await insertMD({ kind: "brand", value: brand });
    if (!ok) return;
    if (owner) await supabase.from("store_links").insert({ client_id: clientId, owner, brand, store_name: null });
    reload(clientId);
  }
  async function addStore(storeName: string, brand: string) {
    const owner = ownerOfBrand(brand) || null;
    const ok = await insertMD({ kind: "store", value: storeName });
    if (!ok) return;
    if (brand) await supabase.from("store_links").insert({ client_id: clientId, owner, brand, store_name: storeName });
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
            Master reference data — Owner · Brand · Store hierarchy, City, Platform.
          </div>
        </div>
        <button onClick={syncFromUploads} disabled={syncing}
          style={{ flexShrink: 0, padding: "9px 18px", borderRadius: 10, border: "none",
            cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.7 : 1, whiteSpace: "nowrap",
            background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)", fontWeight: 700, fontSize: 13 }}>
          {syncing ? "Syncing…" : "⟳ Sync from Uploads"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1fr 1fr 1.1fr 0.8fr", gap: 16, alignItems: "start" }}>

        {/* City */}
        <Card icon="🏙️" title="City" count={cities.length}>
          <NameList items={cities} onDel={(id, val) => delItem(id, "city", val)} />
          <CityAdd onAdd={addCity} />
        </Card>

        {/* Owner */}
        <Card icon="👤" title="Owner" count={owners.length}>
          <NameList items={owners} onDel={(id, val) => delItem(id, "owner", val)} />
          <SimpleAdd placeholder="Owner name" onAdd={addOwner} />
        </Card>

        {/* Brand */}
        <Card icon="🏷️" title="Brand" count={brands.length}>
          <NameList items={brands} onDel={(id, val) => delItem(id, "brand", val)} />
          <BrandAdd ownersList={owners.map((o) => o.value)} onAdd={addBrand} />
        </Card>

        {/* Store */}
        <Card icon="🏬" title="Store" count={stores.length}>
          <StoreNameList
            stores={stores}
            brandOfStore={brandOfStore}
            ownerOfStore={(s) => links.find((l) => l.store_name === s)?.owner || null}
            onDel={(id, val) => delItem(id, "store", val)}
          />
          <StoreAdd brandsList={brands.map((b) => b.value)} onAdd={addStore} />
        </Card>

        {/* Platform */}
        <Card icon="📦" title="Platform" count={platforms.length}>
          <NameList items={platforms} onDel={(id, val) => delItem(id, "platform", val)} />
          <SimpleAdd placeholder="Platform name" onAdd={addPlatform} />
        </Card>

      </div>
    </>
  );
}

/* ── Card wrapper ── */
function Card({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 17 }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>{title}</h3>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "2px 9px" }}>{count}</span>
      </div>
      <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>{children}</div>
    </div>
  );
}

/* ── plain name list (City, Owner, Brand, Platform) ── */
function NameList({ items, onDel }: { items: { id: string; value: string }[]; onDel: (id: string, val: string) => void }) {
  if (!items.length) return <Empty />;
  return (
    <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map((i) => (
        <div key={i.id} style={rowStyle}>
          <span style={{ flex: 1, fontSize: 13 }}>{i.value}</span>
          <DelBtn onClick={() => onDel(i.id, i.value)} />
        </div>
      ))}
    </div>
  );
}

/* ── store list — store name big, owner · brand small + low opacity ── */
function StoreNameList({ stores, brandOfStore, ownerOfStore, onDel }: {
  stores: { id: string; value: string }[];
  brandOfStore: (s: string) => string | null;
  ownerOfStore: (s: string) => string | null;
  onDel: (id: string, val: string) => void;
}) {
  if (!stores.length) return <Empty />;
  return (
    <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
      {stores.map((s) => {
        const brand = brandOfStore(s.value);
        const owner = ownerOfStore(s.value);
        const meta = [owner, brand].filter(Boolean).join(" · ");
        return (
          <div key={s.id} style={rowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{s.value}</div>
              {meta && <div style={{ fontSize: 10.5, opacity: 0.45, marginTop: 2 }}>{meta}</div>}
            </div>
            <DelBtn onClick={() => onDel(s.id, s.value)} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Brand add — name input + required owner selector ── */
function BrandAdd({ ownersList, onAdd }: { ownersList: string[]; onAdd: (brand: string, owner: string) => void }) {
  const [brand, setBrand] = useState("");
  const [owner, setOwner] = useState("");
  const [err, setErr] = useState("");
  const go = () => {
    if (!brand.trim()) return;
    if (!owner) { setErr("Select an owner"); return; }
    setErr("");
    onAdd(brand.trim(), owner);
    setBrand("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={{ ...fieldStyle, flex: 1 }} placeholder="Brand name"
          value={brand} onChange={(e) => { setBrand(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && go()} />
        <button style={plusStyle} onClick={go}>+</button>
      </div>
      <Dropdown
        value={owner}
        options={ownersList}
        placeholder="Select owner"
        emptyText="No owners yet — add one first"
        error={!!err}
        onChange={(v) => { setOwner(v); setErr(""); }}
      />
      {err && <div style={{ fontSize: 11, color: "#ff9a9a" }}>{err}</div>}
    </div>
  );
}

/* ── Store add — name input + required brand selector ── */
function StoreAdd({ brandsList, onAdd }: { brandsList: string[]; onAdd: (name: string, brand: string) => void }) {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [err, setErr] = useState("");
  const go = () => {
    if (!name.trim()) return;
    if (!brand) { setErr("Select a brand"); return; }
    setErr("");
    onAdd(name.trim(), brand);
    setName("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={{ ...fieldStyle, flex: 1 }} placeholder="Store name"
          value={name} onChange={(e) => { setName(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && go()} />
        <button style={plusStyle} onClick={go}>+</button>
      </div>
      <Dropdown
        value={brand}
        options={brandsList}
        placeholder="Select brand"
        emptyText="No brands yet — add one first"
        error={!!err}
        onChange={(v) => { setBrand(v); setErr(""); }}
      />
      {err && <div style={{ fontSize: 11, color: "#ff9a9a" }}>{err}</div>}
    </div>
  );
}

/* ── Custom dropdown — styled menu (replaces ugly native <select>) ── */
function Dropdown({ value, options, placeholder, emptyText, error, onChange }: {
  value: string;
  options: string[];
  placeholder: string;
  emptyText?: string;
  error?: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
          background: "rgba(10,22,40,.6)",
          border: `1px solid ${error ? "rgba(239,68,68,.55)" : open ? "var(--gold)" : "rgba(201,162,39,.22)"}`,
          color: value ? "var(--text)" : "var(--muted)", fontSize: 13, outline: "none",
          transition: "border-color .15s",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value || placeholder}
        </span>
        <span style={{ fontSize: 10, color: "var(--gold)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "var(--navy, #0e1d33)", border: "1px solid var(--gold)", borderRadius: 10,
          boxShadow: "0 -8px 32px rgba(0,0,0,.55)", overflow: "hidden", maxHeight: 240, overflowY: "auto",
        }}>
          {options.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
              {emptyText || "No options"}
            </div>
          ) : (
            options.map((o) => {
              const active = o === value;
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => { onChange(o); setOpen(false); }}
                  style={{
                    width: "100%", display: "block", textAlign: "left",
                    padding: "9px 12px", border: "none", cursor: "pointer", fontSize: 13,
                    background: active ? "rgba(201,162,39,.18)" : "transparent",
                    color: active ? "var(--gold)" : "var(--text)",
                    fontWeight: active ? 700 : 400,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(201,162,39,.08)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  {o}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ── City add ── */
function CityAdd({ onAdd }: { onAdd: (c: string, pic: string) => void }) {
  const [city, setCity] = useState(""); const [pic, setPic] = useState("");
  const go = () => { if (city.trim()) { onAdd(city.trim(), pic.trim()); setCity(""); setPic(""); } };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: "auto" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={{ ...fieldStyle, flex: 1 }} placeholder="City" value={city}
          onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button style={plusStyle} onClick={go}>+</button>
      </div>
      <input style={{ ...fieldStyle, width: "100%", boxSizing: "border-box" }} placeholder="PIC (optional)" value={pic}
        onChange={(e) => setPic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
    </div>
  );
}

/* ── Simple add ── */
function SimpleAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v.trim()); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, flex: 1 }} placeholder={placeholder} value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

function Empty() {
  return <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 4px", textAlign: "center" }}>No entries yet</div>;
}
function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Remove"
      style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#ff9a9a")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}>×</button>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  background: "rgba(10,22,40,.55)", border: "1px solid var(--line)",
  borderRadius: 10, padding: "8px 12px",
};
const fieldStyle: React.CSSProperties = {
  padding: "9px 12px", borderRadius: 10,
  border: "1px solid rgba(201,162,39,.22)",
  background: "rgba(10,22,40,.6)", color: "var(--text)",
  fontSize: 13, outline: "none", minWidth: 0,
};
const plusStyle: React.CSSProperties = {
  flexShrink: 0, width: 40, borderRadius: 10, border: "none", cursor: "pointer",
  background: "linear-gradient(135deg,var(--gold),var(--gold-soft))",
  color: "var(--navy-deep)", fontWeight: 800, fontSize: 18,
};
