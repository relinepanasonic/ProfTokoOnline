"use client";

// Superadmin-only: create / edit / delete Kampus Online workshop events.
// The public marketing site (profesoronline.id/kampus/...) reads the next
// upcoming published event from this table with the anon key, so adding an
// event here is all it takes — no code change or re-upload. layout.tsx's
// route guard keeps /workshops superadmin-only and RLS (migration 0127)
// enforces it on writes. All times are WIB (Asia/Jakarta, +07:00).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";

type Ev = {
  id: string; title: string; starts_at: string; mode: "offline" | "online";
  place: string; address: string; city: string;
  seats_total: number; seats_taken: number; published: boolean;
};
type Form = {
  id: string | null; title: string; date: string; time: string; mode: "offline" | "online";
  place: string; address: string; city: string; seats_total: string; seats_taken: string; published: boolean;
};

const DEFAULT_TITLE = "Kampus Online: Bosan Boncos, Belajar untuk Cuan";
const blank = (date = ""): Form => ({
  id: null, title: DEFAULT_TITLE, date, time: "12:00", mode: "online",
  place: "", address: "", city: "", seats_total: "30", seats_taken: "0", published: true,
});

const TZ = "Asia/Jakarta";
// "2026-11-21" / "12:00" in WIB for a stored instant
const wibParts = (iso: string) => {
  const s = new Date(iso).toLocaleString("sv-SE", { timeZone: TZ }); // "2026-11-21 12:00:00"
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
};
const fmtLong = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(".", ".") + " WIB";
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const inputStyle = { background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" } as const;

export default function WorkshopsPage() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(blank());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cal, setCal] = useState<{ y: number; m: number } | null>(null); // m: 0-11
  const [todayStr, setTodayStr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("workshop_events").select("*").order("starts_at", { ascending: false });
    if (error) setMsg("✗ " + error.message);
    setEvents((data as Ev[]) || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    // "today" is only known in the browser (WIB), so it can't be initial state
    const t = wibParts(new Date().toISOString()).date;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTodayStr(t);
    setCal({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 });
    load();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [load]);

  const byDay = useMemo(() => {
    const map: Record<string, Ev[]> = {};
    events.forEach((e) => { (map[wibParts(e.starts_at).date] ||= []).push(e); });
    return map;
  }, [events]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setMsg("");
    const total = Number(form.seats_total), taken = Number(form.seats_taken);
    if (!form.title.trim()) return setMsg("✗ Workshop title is required.");
    if (!form.date || !form.time) return setMsg("✗ Pick a date and time.");
    if (!(total > 0)) return setMsg("✗ Total seats must be more than 0.");
    if (!(taken >= 0)) return setMsg("✗ Seats taken can't be negative.");
    if (form.mode === "offline" && !form.place.trim() && !form.address.trim()) return setMsg("✗ Offline workshop needs a place or address.");
    const row = {
      title: form.title.trim(),
      starts_at: new Date(`${form.date}T${form.time}:00+07:00`).toISOString(),
      mode: form.mode,
      place: form.place.trim(), address: form.address.trim(), city: form.city.trim(),
      seats_total: total, seats_taken: taken, published: form.published,
      updated_at: new Date().toISOString(),
    };
    setBusy(true);
    const { error } = form.id
      ? await supabase.from("workshop_events").update(row).eq("id", form.id)
      : await supabase.from("workshop_events").insert(row);
    setBusy(false);
    if (error) return setMsg("✗ " + error.message);
    setMsg(form.id ? "✓ Event updated — the website shows it now." : "✓ Event created — the website shows it now.");
    setForm(blank());
    load();
  }

  function edit(e: Ev) {
    const { date, time } = wibParts(e.starts_at);
    setForm({
      id: e.id, title: e.title, date, time, mode: e.mode, place: e.place, address: e.address, city: e.city,
      seats_total: String(e.seats_total), seats_taken: String(e.seats_taken), published: e.published,
    });
    setMsg("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(e: Ev) {
    if (!confirm(`Delete "${e.title}" on ${fmtLong(e.starts_at)}? This cannot be undone.`)) return;
    const { error } = await supabase.from("workshop_events").delete().eq("id", e.id);
    if (error) setMsg("✗ " + error.message); else { if (form.id === e.id) setForm(blank()); load(); }
  }

  if (loading || !cal) return <Loader center />;

  // calendar grid (weeks start Monday)
  const first = new Date(Date.UTC(cal.y, cal.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(cal.y, cal.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const shiftMonth = (d: number) => setCal((c) => {
    const n = (c as { y: number; m: number }).m + d;
    return { y: (c as { y: number }).y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
  });

  const nowIso = new Date().toISOString();
  const upcoming = events.filter((e) => e.starts_at >= nowIso).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = events.filter((e) => e.starts_at < nowIso);

  const row = (e: Ev) => (
    <tr key={e.id}>
      <td style={{ whiteSpace: "nowrap" }}>{fmtLong(e.starts_at)}</td>
      <td>{e.title}{!e.published && <span className="hint"> · hidden</span>}</td>
      <td>{e.mode === "offline" ? "Offline" : "Online"}{e.mode === "offline" && (e.place || e.city) ? <div className="hint">{[e.place, e.city].filter(Boolean).join(", ")}</div> : null}</td>
      <td className="num">{e.seats_taken}/{e.seats_total}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <button className="btn-ghost" onClick={() => edit(e)}>Edit</button>{" "}
        <button className="btn-ghost" onClick={() => remove(e)}>Delete</button>
      </td>
    </tr>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, color: msg.startsWith("✓") ? "#86efac" : "#ff9a9a", background: msg.startsWith("✓") ? "rgba(34,197,94,.1)" : "rgba(239,68,68,.1)", border: "1px solid rgba(255,255,255,.12)" }}>{msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, alignItems: "start" }}>
        {/* Mini calendar */}
        <div className="panel">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button className="btn-ghost" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <h3 style={{ margin: 0 }}>{MONTHS[cal.m]} {cal.y}</h3>
            <button className="btn-ghost" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, textAlign: "center", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {cells.map((d, i) => {
              if (d == null) return <div key={i} />;
              const ds = `${cal.y}-${pad(cal.m + 1)}-${pad(d)}`;
              const has = byDay[ds]?.length;
              const selected = form.date === ds;
              const isToday = ds === todayStr;
              return (
                <button key={i} type="button" onClick={() => set("date", ds)}
                  title={has ? byDay[ds].map((e) => e.title).join(" / ") : undefined}
                  style={{
                    padding: "8px 0", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: has || selected ? 800 : 500,
                    color: selected ? "#0a1730" : "#e8edf8",
                    background: selected ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : has ? "rgba(201,162,39,.22)" : "rgba(255,255,255,.04)",
                    border: isToday ? "1px solid var(--gold)" : "1px solid transparent", position: "relative",
                  }}>
                  {d}
                  {has ? <span style={{ position: "absolute", left: "50%", bottom: 2, width: 5, height: 5, marginLeft: -2.5, borderRadius: "50%", background: selected ? "#0a1730" : "var(--gold)" }} /> : null}
                </button>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 10 }}>Click a day to pick the date. Gold dots are days that already have a workshop.</div>
        </div>

        {/* Form */}
        <div className="panel">
          <h3 style={{ margin: "0 0 10px" }}>{form.id ? "Edit workshop" : "New workshop"}</h3>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="fld"><label>Workshop title</label>
              <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} style={inputStyle} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="fld"><label>Date</label>
                <input type="date" value={form.date} onChange={(e) => {
                  set("date", e.target.value);
                  if (e.target.value) setCal({ y: Number(e.target.value.slice(0, 4)), m: Number(e.target.value.slice(5, 7)) - 1 });
                }} style={inputStyle} /></div>
              <div className="fld"><label>Time (WIB)</label>
                <input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} style={inputStyle} /></div>
            </div>
            <div className="fld"><label>Format</label>
              <div style={{ display: "flex", gap: 8 }}>
                {([["offline", "Offline Workshop"], ["online", "Online Webinar"]] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => set("mode", v)}
                    className={form.mode === v ? "btn-gold" : "btn-ghost"} style={{ flex: 1 }}>{label}</button>
                ))}
              </div>
            </div>
            <div className="fld"><label>{form.mode === "offline" ? "Place (venue name)" : "Platform (e.g. Zoom)"}</label>
              <input type="text" value={form.place} onChange={(e) => set("place", e.target.value)} style={inputStyle}
                placeholder={form.mode === "offline" ? "e.g. Hotel Santika" : "e.g. Zoom"} /></div>
            {form.mode === "offline" && (<>
              <div className="fld"><label>Address</label>
                <input type="text" value={form.address} onChange={(e) => set("address", e.target.value)} style={inputStyle} /></div>
              <div className="fld"><label>City</label>
                <input type="text" value={form.city} onChange={(e) => set("city", e.target.value)} style={inputStyle} /></div>
            </>)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="fld"><label>Total seats</label>
                <input type="number" min={1} value={form.seats_total} onChange={(e) => set("seats_total", e.target.value)} style={inputStyle} /></div>
              <div className="fld"><label>Seats taken</label>
                <input type="number" min={0} value={form.seats_taken} onChange={(e) => set("seats_taken", e.target.value)} style={inputStyle} /></div>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={form.published} onChange={(e) => set("published", e.target.checked)} />
              Show on the website
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-gold" disabled={busy} onClick={save}>{form.id ? "Save changes" : "Create workshop"}</button>
              {form.id && <button className="btn-ghost" onClick={() => { setForm(blank()); setMsg(""); }}>Cancel</button>}
            </div>
            <div className="hint">The website always shows the <b>next upcoming</b> published workshop (countdown, seats and WhatsApp message). &quot;Seats taken&quot; is a number you update by hand as people confirm.</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 10px" }}>Upcoming <span className="hint">({upcoming.length})</span></h3>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Title</th><th>Format</th><th className="num">Seats</th><th></th></tr></thead>
            <tbody>
              {upcoming.map(row)}
              {!upcoming.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No upcoming workshop — the website will say &quot;schedule coming soon&quot;.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 10px" }}>Past <span className="hint">({past.length})</span></h3>
        <div className="tbl-wrap" style={{ maxHeight: 320 }}>
          <table className="tbl">
            <thead><tr><th>When</th><th>Title</th><th>Format</th><th className="num">Seats</th><th></th></tr></thead>
            <tbody>
              {past.map(row)}
              {!past.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Nothing yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
