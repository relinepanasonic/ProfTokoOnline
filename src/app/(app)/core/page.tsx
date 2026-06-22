"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Item = { id: string; kind: string; value: string; pic: string | null; city: string | null };
type Client = { id: string; name: string };

export default function CoreListPage() {
  const [supabase] = useState(() => createClient());
  const [isSuper, setIsSuper] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");

  // input states
  const [cityIn, setCityIn] = useState(""); const [cityPic, setCityPic] = useState("");
  const [dealerIn, setDealerIn] = useState(""); const [dealerCity, setDealerCity] = useState("");
  const [brandIn, setBrandIn] = useState(""); const [typeIn, setTypeIn] = useState("");

  const reload = useCallback(async (cid: string) => {
    if (!cid) { setItems([]); return; }
    const { data } = await supabase.from("master_data")
      .select("id,kind,value,pic,city").eq("client_id", cid).order("value");
    setItems((data as Item[]) || []);
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
  const dealers = items.filter((i) => i.kind === "dealer");
  const brands = items.filter((i) => i.kind === "brand");
  const types = items.filter((i) => i.kind === "product_type");

  async function add(kind: string, value: string, extra: { pic?: string; city?: string } = {}) {
    if (!clientId) { setMsg("Pick a client first"); return; }
    if (!value.trim()) return;
    setMsg("");
    const { error } = await supabase.from("master_data").insert({
      client_id: clientId, kind, value: value.trim(), pic: extra.pic || null, city: extra.city || null,
    });
    if (error) { setMsg("✗ " + error.message); return; }
    reload(clientId);
  }
  async function remove(id: string) {
    await supabase.from("master_data").delete().eq("id", id);
    reload(clientId);
  }

  const picForCity = (c: string) => cities.find((x) => x.value === c)?.pic || "";

  const smallInp: React.CSSProperties = { flex: 1, padding: "7px 9px", borderRadius: 8, border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.7)", color: "var(--text)", fontSize: 12, minWidth: 0 };
  const addBtn: React.CSSProperties = { background: "var(--gold)", border: "none", borderRadius: 8, width: 34, cursor: "pointer", fontWeight: 800, color: "var(--navy-deep)" };

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div><h3 style={{ margin: 0 }}>Core List</h3>
          <div className="hint">Master data behind every dropdown — City+PIC, Dealer, Brand &amp; Product Type. Add here and it appears in Upload.</div></div>
        {isSuper && clients.length > 0 && (
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); reload(e.target.value); }}
            style={{ padding: "8px 11px", borderRadius: 10, border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13 }}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 16 }} className="core-grid">
        {/* City + PIC */}
        <Col title="City & PIC (1 city = 1 PIC)">
          <List items={cities} render={(i) => <span>{i.value} <span style={{ color: "var(--muted)" }}>· {i.pic || "—"}</span></span>} onDel={remove} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input style={smallInp} placeholder="City" value={cityIn} onChange={(e) => setCityIn(e.target.value)} />
            <input style={smallInp} placeholder="PIC" value={cityPic} onChange={(e) => setCityPic(e.target.value)} />
            <button style={addBtn} onClick={() => { add("city", cityIn, { pic: cityPic }); setCityIn(""); setCityPic(""); }}>+</button>
          </div>
        </Col>

        {/* Dealer */}
        <Col title="Dealers">
          <List items={dealers} render={(i) => <span>{i.value} <span style={{ color: "var(--muted)" }}>· {i.city || "—"}</span></span>} onDel={remove} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <input style={smallInp} placeholder="Dealer name" value={dealerIn} onChange={(e) => setDealerIn(e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
              <select style={smallInp} value={dealerCity} onChange={(e) => setDealerCity(e.target.value)}>
                <option value="">Select city</option>
                {cities.map((c) => <option key={c.id} value={c.value}>{c.value}</option>)}
              </select>
              <button style={addBtn} onClick={() => { add("dealer", dealerIn, { city: dealerCity, pic: picForCity(dealerCity) }); setDealerIn(""); setDealerCity(""); }}>+</button>
            </div>
          </div>
        </Col>

        {/* Brand */}
        <Col title="Brands">
          <List items={brands} render={(i) => <span>{i.value}</span>} onDel={remove} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input style={smallInp} placeholder="Add brand" value={brandIn} onChange={(e) => setBrandIn(e.target.value)} />
            <button style={addBtn} onClick={() => { add("brand", brandIn); setBrandIn(""); }}>+</button>
          </div>
        </Col>

        {/* Product Type */}
        <Col title="Product Types">
          <List items={types} render={(i) => <span>{i.value}</span>} onDel={remove} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input style={smallInp} placeholder="Add type" value={typeIn} onChange={(e) => setTypeIn(e.target.value)} />
            <button style={addBtn} onClick={() => { add("product_type", typeIn); setTypeIn(""); }}>+</button>
          </div>
        </Col>
      </div>
      {msg && <div style={{ color: "#ff9a9a", fontSize: 13, marginTop: 12 }}>{msg}</div>}
    </div>
  );
}

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--gold)", marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function List({ items, render, onDel }: { items: Item[]; render: (i: Item) => React.ReactNode; onDel: (id: string) => void }) {
  return (
    <div style={{ maxHeight: 220, overflow: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map((i) => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, background: "rgba(10,22,40,.6)", border: "1px solid rgba(201,162,39,.15)", borderRadius: 8, padding: "5px 8px", fontSize: 12 }}>
          {render(i)}
          <button onClick={() => onDel(i.id)} style={{ background: "none", border: "none", color: "#ff9a9a", cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      ))}
      {items.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12, padding: "6px 2px" }}>Empty</div>}
    </div>
  );
}
