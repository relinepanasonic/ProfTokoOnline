"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Item = { id: string; kind: string; value: string; pic: string | null; city: string | null };

export default function CoreListPage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); return; }
    const { data } = await supabase
      .from("master_data")
      .select("id,kind,value,pic,city")
      .eq("client_id", cid)
      .order("value");
    setItems((data as Item[]) || []);
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

  const cities = items.filter((i) => i.kind === "city");
  const dealers = items.filter((i) => i.kind === "store");
  const brands = items.filter((i) => i.kind === "brand");
  const types = items.filter((i) => i.kind === "platform");

  // city -> its PIC, for the dealer auto-PIC
  const picOfCity = (city: string) => cities.find((c) => c.value === city)?.pic || null;

  async function insertRow(row: Record<string, unknown>) {
    if (!clientId) { setMsg("Workspace not ready — refresh the page"); return; }
    setMsg("");
    const { error } = await supabase.from("master_data").insert({ client_id: clientId, ...row });
    if (error) { setMsg(error.code === "23505" ? `"${row.value}" already exists` : "✗ " + error.message); return; }
    reload(clientId);
  }
  async function delItem(id: string) { await supabase.from("master_data").delete().eq("id", id); reload(clientId); }

  async function syncFromUploads() {
    setSyncing(true); setMsg("");
    try {
      const res = await fetch("/api/core/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setMsg("✗ Sync failed: " + (json.error || res.statusText)); }
      else { setMsg(`✓ Synced ${json.stores} stores across ${json.clients} client(s). Refresh to see updated Core List.`); reload(clientId); }
    } catch (e) {
      setMsg("✗ Sync error: " + String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      {msg && <div style={{ color: msg.startsWith("✓") ? "#86efac" : "#ff9a9a", fontSize: 13, marginBottom: 12, background: msg.startsWith("✓") ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)", border: msg.startsWith("✓") ? "1px solid rgba(34,197,94,.2)" : "1px solid rgba(239,68,68,.2)", borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}

      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h3 style={{ margin: 0 }}>Core List</h3>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
            Master data behind every dropdown — City, Store, Brand — used across Upload and filters. Add entries manually or sync from existing upload data.
          </div>
        </div>
        <button
          onClick={syncFromUploads}
          disabled={syncing}
          style={{ flexShrink: 0, padding: "9px 18px", borderRadius: 10, border: "none", cursor: syncing ? "default" : "pointer", background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)", fontWeight: 700, fontSize: 13, opacity: syncing ? 0.7 : 1, whiteSpace: "nowrap" }}
        >
          {syncing ? "Syncing…" : "Sync from Uploads"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 1fr", gap: 16, alignItems: "start" }}>
        {/* City & PIC */}
        <Card icon="🏙️" title="City & PIC" hint="1 city = 1 PIC" count={cities.length}>
          <DealerOrCityList
            rows={cities.map((c) => ({ id: c.id, main: c.value, sub: c.pic }))}
            onDel={delItem}
          />
          <CityAdd onAdd={(city, pic) => insertRow({ kind: "city", value: city, pic: pic || null })} />
        </Card>

        {/* Stores */}
        <Card icon="🏬" title="Stores" count={dealers.length}>
          <DealerOrCityList
            rows={dealers.map((d) => ({ id: d.id, main: d.value, sub: [d.city, d.pic].filter(Boolean).join(" — ") }))}
            onDel={delItem}
          />
          <DealerAdd
            cities={cities.map((c) => c.value)}
            picOfCity={picOfCity}
            onAdd={(name, city) => insertRow({ kind: "store", value: name, city: city || null, pic: picOfCity(city) })}
          />
        </Card>

        {/* Brands */}
        <Card icon="🏷️" title="Brands" count={brands.length}>
          <PlainList items={brands} onDel={delItem} />
          <SimpleAdd placeholder="Add brand" onAdd={(v) => insertRow({ kind: "brand", value: v })} />
        </Card>

        {/* Product Types */}
        <Card icon="📦" title="Product Types" count={types.length}>
          <PlainList items={types} onDel={delItem} />
          <SimpleAdd placeholder="Add type" onAdd={(v) => insertRow({ kind: "platform", value: v })} />
        </Card>
      </div>
    </>
  );
}

/* ---------- shared ---------- */
function Card({ icon, title, hint, count, children }: { icon: string; title: string; hint?: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          {hint && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{hint}</div>}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "2px 10px" }}>{count}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>{children}</div>
    </div>
  );
}

// list with a main label + optional grey sub-label (used by City and Dealer)
function DealerOrCityList({ rows, onDel }: { rows: { id: string; main: string; sub: string | null }[]; onDel: (id: string) => void }) {
  if (!rows.length) return <Empty />;
  return (
    <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.id} style={rowStyle}>
          <span style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
            {r.main}{r.sub ? <span style={{ color: "var(--muted)" }}> — {r.sub}</span> : null}
          </span>
          <DelBtn onClick={() => onDel(r.id)} />
        </div>
      ))}
    </div>
  );
}

function PlainList({ items, onDel }: { items: Item[]; onDel: (id: string) => void }) {
  if (!items.length) return <Empty />;
  return (
    <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((i) => (
        <div key={i.id} style={rowStyle}>
          <span style={{ flex: 1, fontSize: 13 }}>{i.value}</span>
          <DelBtn onClick={() => onDel(i.id)} />
        </div>
      ))}
    </div>
  );
}

function CityAdd({ onAdd }: { onAdd: (city: string, pic: string) => void }) {
  const [city, setCity] = useState(""); const [pic, setPic] = useState("");
  const go = () => { if (city.trim()) { onAdd(city.trim(), pic.trim()); setCity(""); setPic(""); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 40px", gap: 8, marginTop: "auto" }}>
      <input style={fieldStyle} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <input style={fieldStyle} placeholder="PIC for this city" value={pic} onChange={(e) => setPic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

function DealerAdd({ cities, picOfCity, onAdd }: { cities: string[]; picOfCity: (c: string) => string | null; onAdd: (name: string, city: string) => void }) {
  const [name, setName] = useState(""); const [city, setCity] = useState("");
  const go = () => { if (name.trim()) { onAdd(name.trim(), city); setName(""); setCity(""); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 40px", gap: 8, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, gridColumn: "1 / -1" }} placeholder="Store name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <select style={fieldStyle} value={city} onChange={(e) => setCity(e.target.value)}>
        <option value="">Select city</option>
        {cities.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input style={fieldStyle} placeholder="PIC (auto)" value={city ? (picOfCity(city) || "") : ""} disabled />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

function SimpleAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v.trim()); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, flex: 1 }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

function Empty() { return <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "10px 4px", textAlign: "center" }}>No entries yet</div>; }
function DelBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} title="Remove"
      style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", justifySelf: "end" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "#ff9a9a")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}>×</button>
  );
}

const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" };
const fieldStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13, outline: "none", minWidth: 0 };
const plusStyle: React.CSSProperties = { flexShrink: 0, width: 40, borderRadius: 10, border: "none", cursor: "pointer", background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)", fontWeight: 800, fontSize: 18 };
