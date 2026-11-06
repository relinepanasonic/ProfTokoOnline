"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { owner: string; group_id: string; enabled: boolean };

// One WhatsApp group per Owner for the weekly report (sent by Make.com via GET /api/reports/weekly).
// The group id comes from the WhatsApp gateway, e.g. 1203630xxxxxxxxxx@g.us.
export default function ReportGroups({ clientId, owners }: { clientId: string; owners: string[] }) {
  const [supabase] = useState(() => createClient());
  const [saved, setSaved] = useState<Record<string, Row>>({});
  const [draft, setDraft] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!clientId) return;
    const { data } = await supabase.from("report_groups").select("owner,group_id,enabled").eq("client_id", clientId);
    const m: Record<string, Row> = {};
    for (const r of (data as Row[]) || []) m[r.owner] = r;
    setSaved(m);
    setDraft({});
  }, [supabase, clientId]);

  useEffect(() => { load(); }, [load]);

  const cur = (o: string): Row => draft[o] || saved[o] || { owner: o, group_id: "", enabled: false };
  const dirty = (o: string) => {
    const a = cur(o), b = saved[o] || { owner: o, group_id: "", enabled: false };
    return a.group_id !== b.group_id || a.enabled !== b.enabled;
  };

  async function save(o: string) {
    const r = cur(o);
    const groupId = r.group_id.trim();
    if (r.enabled && !groupId) { setMsg("✗ Enter the group ID before switching the report on"); return; }
    setBusy(o); setMsg("");
    const { error } = await supabase.from("report_groups").upsert(
      { client_id: clientId, owner: o, group_id: groupId, enabled: r.enabled, updated_at: new Date().toISOString() },
      { onConflict: "client_id,owner" },
    );
    setBusy("");
    if (error) { setMsg("✗ " + error.message); return; }
    setMsg(`✓ Saved ${o}`);
    load();
  }

  if (!owners.length) return null;
  return (
    <div className="panel" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>💬 Weekly WhatsApp report</h3>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          Every Monday each Owner&apos;s report goes to their own WhatsApp group. Paste the group ID from your WhatsApp gateway.
        </div>
      </div>
      <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 8 }}>
        {msg && <div style={{ fontSize: 12.5, color: msg.startsWith("✓") ? "#86efac" : "#ff9a9a" }}>{msg}</div>}
        {owners.map((o) => {
          const r = cur(o);
          return (
            <div key={o} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              background: "rgba(10,22,40,.55)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ width: 180, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o}>{o}</span>
              <input
                placeholder="1203630xxxxxxxxxx@g.us" value={r.group_id}
                onChange={(e) => setDraft((d) => ({ ...d, [o]: { ...cur(o), group_id: e.target.value } }))}
                style={{ flex: 1, minWidth: 220, padding: "8px 11px", borderRadius: 10, border: "1px solid rgba(201,162,39,.22)",
                  background: "rgba(10,22,40,.6)", color: "var(--text)", fontSize: 13, outline: "none" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={r.enabled}
                  onChange={(e) => setDraft((d) => ({ ...d, [o]: { ...cur(o), enabled: e.target.checked } }))} />
                Send
              </label>
              <button onClick={() => save(o)} disabled={!dirty(o) || busy === o}
                style={{ padding: "7px 14px", borderRadius: 9, border: "none", fontWeight: 700, fontSize: 12.5,
                  cursor: dirty(o) && busy !== o ? "pointer" : "default", opacity: dirty(o) ? 1 : 0.4,
                  background: "linear-gradient(135deg,var(--gold),var(--gold-soft))", color: "var(--navy-deep)" }}>
                {busy === o ? "…" : "Save"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
