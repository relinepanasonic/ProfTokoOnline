"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Item = { id: string; kind: string; value: string };
type Link = { id: string; owner: string | null; store_name: string | null; brand: string | null };
type Client = { id: string; name: string };

export default function CoreListPage() {
  const [supabase] = useState(() => createClient());
  const [isSuper, setIsSuper] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); setLinks([]); return; }
    const [{ data: md }, { data: sl }] = await Promise.all([
      supabase.from("master_data").select("id,kind,value").eq("client_id", cid).in("kind", ["city", "platform"]).order("value"),
      supabase.from("store_links").select("id,owner,store_name,brand").eq("client_id", cid).order("created_at"),
    ]);
    setItems((md as Item[]) || []);
    setLinks((sl as Link[]) || []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role,client_id").eq("id", user.id).single();
      const sup = p?.role === "superadmin";
      setIsSuper(sup);
      const { data: cs } = await supabase.from("clients").select("id,name").order("name");
      setClients((cs as Client[]) || []);
      const initial = sup ? ((cs as Client[])?.[0]?.id || "") : (p?.client_id || "");
      setClientId(initial);
      reload(initial);
    })();
  }, [supabase, reload]);

  const cities = items.filter((i) => i.kind === "city");
  const platforms = items.filter((i) => i.kind === "platform");

  async function addItem(kind: string, value: string) {
    if (!clientId) { setMsg("Pick a client first"); return; }
    if (!value.trim()) return;
    setMsg("");
    const { error } = await supabase.from("master_data").insert({ client_id: clientId, kind, value: value.trim() });
    if (error) { setMsg(error.code === "23505" ? `"${value}" already exists` : "✗ " + error.message); return; }
    reload(clientId);
  }
  async function delItem(id: string) { await supabase.from("master_data").delete().eq("id", id); reload(clientId); }

  async function addLink(owner: string, store: string, brand: string) {
    if (!clientId) { setMsg("Pick a client first"); return; }
    if (!owner.trim() && !store.trim() && !brand.trim()) return;
    setMsg("");
    const { error } = await supabase.from("store_links").insert({
      client_id: clientId, owner: owner.trim() || null, store_name: store.trim() || null, brand: brand.trim() || null,
    });
    if (error) { setMsg("✗ " + error.message); return; }
    reload(clientId);
  }
  async function delLink(id: string) { await supabase.from("store_links").delete().eq("id", id); reload(clientId); }

  // distinct suggestions for the datalists
  const uniq = (xs: (string | null)[]) => Array.from(new Set(xs.filter(Boolean) as string[]));
  const owners = uniq(links.map((l) => l.owner));
  const stores = uniq(links.map((l) => l.store_name));
  const brands = uniq(links.map((l) => l.brand));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: "#fff", fontWeight: 800 }}>Core List</h2>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Master data behind every dropdown.</div>
        </div>
        {isSuper && clients.length > 0 && (
          <div className="fld" style={{ minWidth: 180 }}>
            <label>Client</label>
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); reload(e.target.value); }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {msg && <div style={{ color: "#ff9a9a", fontSize: 13, marginBottom: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}

      {/* Top: City + Platform (standalone, 2 columns) */}
      <div className="core-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card icon="🏙️" title="Cities" count={cities.length}>
          <ItemList items={cities} onDel={delItem} />
          <SimpleAdd placeholder="Add city…" onAdd={(v) => addItem("city", v)} />
        </Card>
        <Card icon="🛒" title="Platforms" count={platforms.length}>
          <ItemList items={platforms} onDel={delItem} />
          <SimpleAdd placeholder="Add platform…" onAdd={(v) => addItem("platform", v)} />
        </Card>
      </div>

      {/* Combined: Owner · Brand · Store Name */}
      <Card icon="🔗" title="Owners · Brands · Store Names" count={links.length}>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 4 }}>
          One owner can have many brands; one brand many stores. Add each combination as a row.
        </div>
        <LinkTable rows={links} onDel={delLink} />
        <LinkAdd owners={owners} stores={stores} brands={brands} onAdd={addLink} />
      </Card>

      <datalist id="dl-owner">{owners.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="dl-store">{stores.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="dl-brand">{brands.map((b) => <option key={b} value={b} />)}</datalist>
    </>
  );
}

/* ---------- shared ---------- */
function Card({ icon, title, count, children }: { icon: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", background: "rgba(201,162,39,.12)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 999, padding: "2px 10px" }}>{count}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>{children}</div>
    </div>
  );
}

function ItemList({ items, onDel }: { items: Item[]; onDel: (id: string) => void }) {
  if (!items.length) return <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "10px 4px", textAlign: "center" }}>No entries yet</div>;
  return (
    <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((i) => (
        <div key={i.id} style={rowStyle}>
          <span style={{ flex: 1, fontSize: 13 }}>{i.value}</span>
          <DelBtn onClick={() => onDel(i.id)} />
        </div>
      ))}
    </div>
  );
}

function LinkTable({ rows, onDel }: { rows: Link[]; onDel: (id: string) => void }) {
  if (!rows.length) return <div style={{ color: "var(--muted)", fontSize: 12.5, padding: "10px 4px", textAlign: "center" }}>No entries yet</div>;
  return (
    <div style={{ maxHeight: 300, overflowY: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 28px", gap: 8, fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em", padding: "0 12px 6px" }}>
        <span>Owner</span><span>Brand</span><span>Store Name</span><span />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ ...rowStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 28px", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13 }}>{r.owner || "—"}</span>
            <span style={{ fontSize: 13 }}>{r.brand || "—"}</span>
            <span style={{ fontSize: 13 }}>{r.store_name || "—"}</span>
            <DelBtn onClick={() => onDel(r.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkAdd({ owners, stores, brands, onAdd }: { owners: string[]; stores: string[]; brands: string[]; onAdd: (o: string, s: string, b: string) => void }) {
  const [o, setO] = useState(""); const [s, setS] = useState(""); const [b, setB] = useState("");
  const go = () => { onAdd(o, s, b); setO(""); setS(""); setB(""); };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 40px", gap: 8, marginTop: "auto" }}>
      <input list="dl-owner" style={fieldStyle} placeholder="Owner…" value={o} onChange={(e) => setO(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <input list="dl-brand" style={fieldStyle} placeholder="Brand…" value={b} onChange={(e) => setB(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <input list="dl-store" style={fieldStyle} placeholder="Store name…" value={s} onChange={(e) => setS(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

function SimpleAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const go = () => { if (v.trim()) { onAdd(v); setV(""); } };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
      <input style={{ ...fieldStyle, flex: 1 }} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button style={plusStyle} onClick={go}>+</button>
    </div>
  );
}

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
