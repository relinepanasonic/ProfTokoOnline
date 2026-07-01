"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import Dropdown from "@/components/Dropdown";

export const dynamic = "force-dynamic";

type Profile = {
  id: string; email: string | null; display_name: string | null;
  username: string | null; role: string; scope_store: string | null; scope_owner: string | null;
};
type Invite = {
  id: string; token: string; owner_name: string;
  store_name: string | null; role: string;
  created_at: string; expires_at: string; used_at: string | null;
};
type StoreLink = { owner: string | null; store_name: string | null };

const INVITE_ROLES = [
  { v: "branch_manager", l: "Owner" },
  { v: "client_admin",   l: "Admin" },
  { v: "advertiser",     l: "Advertiser" },
  { v: "superadmin",     l: "Superadmin" },
];
const ROLE_LABEL: Record<string, string> = {
  superadmin:     "Super Admin",
  branch_manager: "Owner",
  client_admin:   "Admin",
  store_user:     "Store",
  advertiser:     "Advertiser",
};
const roleColor: Record<string, string> = {
  superadmin:     "#22c55e",
  branch_manager: "#3b82f6",
  client_admin:   "#f59e0b",
  store_user:     "#a78bfa",
  advertiser:     "#ec4899",
};

const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 10,
  border: "1px solid rgba(201,162,39,.25)", background: "rgba(10,22,40,.6)",
  color: "var(--text)", fontSize: 13,
};
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(2,6,16,.75)", backdropFilter: "blur(6px)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000, padding: 16,
};
const modal: React.CSSProperties = {
  background: "rgba(13,26,54,.98)", border: "1px solid rgba(201,162,39,.25)", borderRadius: 18,
  padding: 28, width: "min(92vw,440px)", maxHeight: "90vh", overflowY: "auto",
  boxShadow: "0 30px 80px rgba(0,0,0,.7)",
};

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#7b8db0" }}>{label}</label>
      {children}
    </div>
  );
}

function copyText(t: string) { navigator.clipboard.writeText(t).catch(() => {}); }

export default function UsersPage() {
  const [supabase] = useState(() => createClient());
  const [rows,    setRows]    = useState<Profile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [stores,  setStores]  = useState<StoreLink[]>([]);
  const [token,   setToken]   = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ owner_name: "", role: "branch_manager", username: "" });
  const [busy, setBusy] = useState(false);
  const [msg,  setMsg]  = useState("");
  const [copied, setCopied] = useState(false);

  const getAuthHeader = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token ?? ""}` };
  }, [supabase]);

  const reload = useCallback(async () => {
    const [{ data: p }, h] = await Promise.all([
      supabase.from("profiles").select("id,email,display_name,username,role,scope_store,scope_owner").order("display_name"),
      getAuthHeader(),
    ]);
    setRows((p as Profile[]) || []);
    const r = await fetch("/api/invites", { headers: h });
    if (r.ok) { const j = await r.json(); setInvites(j.invites || []); }
  }, [supabase, getAuthHeader]);

  useEffect(() => {
    (async () => {
      const { data: sl } = await supabase.from("store_links").select("owner,store_name").order("owner");
      setStores((sl as StoreLink[]) || []);
      reload();
    })();
  }, [supabase, reload]);

  const distinctOwners = Array.from(new Set(stores.map((s) => s.owner).filter(Boolean) as string[])).sort();
  const isOwnerRole = form.role === "branch_manager";

  async function createInvite() {
    if (!form.owner_name.trim()) { setMsg(isOwnerRole ? "Select an owner" : "Name is required"); return; }
    setBusy(true); setMsg(""); setToken(null);
    try {
      const h = await getAuthHeader();
      const res = await fetch("/api/invites", {
        method: "POST", headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, username: form.username.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || "Failed"); setBusy(false); return; }
      setToken(j.token as string);
      reload();
    } catch (e) { setMsg(String(e)); }
    setBusy(false);
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invite?")) return;
    const h = await getAuthHeader();
    await fetch("/api/invites", { method: "DELETE", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    reload();
  }

  async function deleteUser(p: Profile) {
    if (!confirm(`Delete user "${p.display_name || p.email}"? This cannot be undone.`)) return;
    const h = await getAuthHeader();
    const res = await fetch("/api/users", { method: "DELETE", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
    const j = await res.json();
    if (!res.ok) { alert(j.error); return; }
    reload();
  }

  const inviteUrl = token && typeof window !== "undefined" ? `${window.location.origin}/join/${token}` : "";
  const pending = invites.filter((i) => !i.used_at && new Date(i.expires_at) > new Date());

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: 0 }}>User Management</h3>
          <div className="hint">Invite owners and admins · they set their own credentials</div>
        </div>
        <button className="btn-gold" onClick={() => { setShowForm(true); setToken(null); setMsg(""); setForm({ owner_name: "", role: "branch_manager", username: "" }); }}>
          + Invite User
        </button>
      </div>

      {/* ── Active Users ── */}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Scope</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.display_name || "—"}</td>
                <td style={{ color: "#c9a227", fontFamily: "monospace", fontSize: 12 }}>{r.username || "—"}</td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.email || "—"}</td>
                <td>
                  <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: `${roleColor[r.role] ?? "#888"}22`, color: roleColor[r.role] ?? "#888",
                    border: `1px solid ${roleColor[r.role] ?? "#888"}44` }}>
                    {ROLE_LABEL[r.role] || r.role}
                  </span>
                </td>
                <td style={{ fontSize: 12 }}>{r.scope_owner || r.scope_store || "—"}</td>
                <td>
                  <button onClick={() => deleteUser(r)}
                    style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.1)", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>No users yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pending Invites ── */}
      {pending.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#7b8db0", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Pending Invites
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {pending.map((inv) => {
              const url = typeof window !== "undefined" ? `${window.location.origin}/join/${inv.token}` : "";
              return (
                <div key={inv.id} style={{ background: "rgba(201,162,39,0.05)", border: "1px solid rgba(201,162,39,0.15)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 140 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#e8edf8" }}>{inv.owner_name}</div>
                    <div style={{ fontSize: 12, color: "#7b8db0" }}>{ROLE_LABEL[inv.role] || inv.role}{inv.store_name ? ` · ${inv.store_name}` : ""}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#7b8db0" }}>Expires {new Date(inv.expires_at).toLocaleDateString()}</div>
                  <button onClick={() => copyText(url)}
                    style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(201,162,39,0.3)", background: "rgba(201,162,39,0.1)", color: "#c9a227", fontSize: 12, cursor: "pointer" }}>
                    Copy Link
                  </button>
                  <button onClick={() => revokeInvite(inv.id)}
                    style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: 12, cursor: "pointer" }}>
                    Revoke
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {showForm && typeof document !== "undefined" && createPortal(
        <div onClick={() => { if (!token) setShowForm(false); }} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={modal}>
            {token ? (
              /* ── Link generated ── */
              <div style={{ display: "grid", gap: 16 }}>
                <h3 style={{ margin: 0, color: "#e8edf8" }}>Invite Created ✅</h3>
                <p style={{ margin: 0, fontSize: 13, color: "#7b8db0" }}>
                  Share this link with <strong style={{ color: "#e8edf8" }}>{form.owner_name}</strong>.
                  They will set their own email, username, and password. Link expires in 7 days.
                </p>
                <div style={{ background: "rgba(201,162,39,0.07)", border: "1px solid rgba(201,162,39,0.2)", borderRadius: 10, padding: "10px 14px", wordBreak: "break-all", fontSize: 13, color: "#c9a227", fontFamily: "monospace" }}>
                  {inviteUrl}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn-gold" style={{ flex: 1 }}
                    onClick={() => { copyText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                    {copied ? "Copied!" : "Copy Link"}
                  </button>
                  <button onClick={() => { setShowForm(false); setToken(null); }}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              /* ── Invite form ── */
              <div style={{ display: "grid", gap: 16 }}>
                <h3 style={{ margin: 0, color: "#e8edf8" }}>Invite New User</h3>
                <p style={{ margin: 0, fontSize: 13, color: "#7b8db0" }}>
                  A link will be sent for the user to create their own account.
                </p>

                <Fld label="Role">
                  <Dropdown
                    value={form.role}
                    options={INVITE_ROLES.map((r) => ({ value: r.v, label: r.l }))}
                    placeholder="Select role"
                    onChange={(v) => setForm({ ...form, role: v, owner_name: "" })}
                  />
                </Fld>

                {isOwnerRole ? (
                  <Fld label="Owner (from Core List)">
                    <Dropdown
                      value={form.owner_name}
                      options={distinctOwners}
                      placeholder="Select owner"
                      emptyText="No owners in Core List yet"
                      onChange={(v) => setForm({ ...form, owner_name: v })}
                    />
                    <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#7b8db0" }}>
                      This login will see every Brand &amp; Store linked to this Owner in Core List.
                    </p>
                  </Fld>
                ) : (
                  <Fld label="Name">
                    <input style={inp} placeholder="e.g. Yunita" value={form.owner_name}
                      onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
                  </Fld>
                )}

                <Fld label="Username (optional — user can set their own)">
                  <input style={inp} placeholder="e.g. yunita_owner"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })} />
                </Fld>

                {msg && (
                  <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 9, padding: "10px 14px", color: "#fca5a5", fontSize: 13 }}>
                    {msg}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button className="btn-gold" style={{ flex: 1 }} disabled={busy} onClick={createInvite}>
                    {busy ? "Generating…" : "Generate Invite Link"}
                  </button>
                  <button onClick={() => setShowForm(false)}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
