"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Invite = { owner_name: string; store_name: string | null; role: string };

const ROLE_LABEL: Record<string, string> = {
  branch_manager: "Owner",
  client_admin:   "Admin",
  store_user:     "Store",
};

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [invite, setInvite]     = useState<Invite | null>(null);
  const [loadErr, setLoadErr]   = useState("");
  const [form, setForm]         = useState({ email: "", username: "", phone: "", password: "", confirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState("");
  const [done, setDone]         = useState(false);

  useEffect(() => {
    fetch(`/api/join?token=${token}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setLoadErr(j.error);
        else setInvite(j.invite as Invite);
      })
      .catch(() => setLoadErr("Failed to load invite"));
  }, [token]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (form.password !== form.confirm) { setErr("Passwords do not match"); return; }
    if (form.password.length < 6)       { setErr("Password must be at least 6 characters"); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(form.username)) {
      setErr("Username may only contain letters, numbers, _ . and -");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email: form.email, username: form.username, phone: form.phone, password: form.password }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error || "Registration failed"); setBusy(false); return; }

    // Auto-sign-in
    const supabase = createClient();
    await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    setDone(true);
    setTimeout(() => router.replace("/"), 1800);
  }

  const field: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 10,
    border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)",
    color: "#e8edf8", fontSize: 13, outline: "none",
  };
  const eye = (show: boolean, toggle: () => void) => (
    <button type="button" tabIndex={-1} onClick={toggle}
      style={{ position:"absolute", right:11, top:"50%", transform:"translateY(-50%)",
               background:"none", border:"none", cursor:"pointer", color:"#7b8db0", padding:0, lineHeight:1 }}>
      {show ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #1a3461 100%)" }}>

      <div style={{ width: "100%", maxWidth: 420, background: "rgba(15,32,64,0.85)",
        border: "1px solid rgba(201,162,39,0.15)", borderRadius: 20, padding: 32,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>

        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{ width: 50, height: 50, borderRadius: "50%",
            background: "linear-gradient(135deg, #1a3461, #0a1628)",
            border: "2px solid rgba(201,162,39,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z"
                fill="rgba(201,162,39,0.2)" stroke="#c9a227" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M9 12l2 2 4-4" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: "#e8edf8" }}>ProfTokoOnline</div>
            <div style={{ fontSize: 12, color: "#7b8db0", marginTop: 2 }}>Create your account</div>
          </div>
        </div>

        <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(201,162,39,0.3),transparent)", marginBottom: 22 }} />

        {/* Loading / error state */}
        {!invite && !loadErr && (
          <div style={{ textAlign: "center", color: "#7b8db0", padding: "20px 0" }}>Loading invite…</div>
        )}
        {loadErr && (
          <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 10, padding: "12px 16px", color: "#fca5a5", textAlign: "center" }}>
            {loadErr}
          </div>
        )}

        {/* Success */}
        {done && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ color: "#e8edf8", fontWeight: 600, marginBottom: 6 }}>Account created!</div>
            <div style={{ color: "#7b8db0", fontSize: 13 }}>Redirecting to dashboard…</div>
          </div>
        )}

        {/* Registration form */}
        {invite && !done && (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
            {/* Pre-filled invite info */}
            <div style={{ background: "rgba(201,162,39,0.06)", border: "1px solid rgba(201,162,39,0.15)",
              borderRadius: 10, padding: "10px 14px", display: "grid", gap: 4 }}>
              <Row label="Name"  value={invite.owner_name} />
              {invite.store_name && <Row label="Store" value={invite.store_name} />}
              <Row label="Role"  value={ROLE_LABEL[invite.role] || invite.role} />
            </div>

            <Fld label="Email">
              <input required type="email" autoComplete="email" placeholder="your@email.com"
                style={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Fld>
            <Fld label="Username">
              <input required type="text" autoComplete="username" placeholder="e.g. yunita_owner"
                style={field} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Fld>
            <Fld label="Phone (optional)">
              <input type="tel" autoComplete="tel" placeholder="08xxxxxxxxxx"
                style={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Fld>
            <Fld label="Password">
              <div style={{ position: "relative" }}>
                <input required type={showPass ? "text" : "password"} autoComplete="new-password"
                  placeholder="minimum 6 characters"
                  style={{ ...field, paddingRight: 40 }} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
                {eye(showPass, () => setShowPass((v) => !v))}
              </div>
            </Fld>
            <Fld label="Confirm Password">
              <div style={{ position: "relative" }}>
                <input required type={showConf ? "text" : "password"} autoComplete="new-password"
                  placeholder="repeat password"
                  style={{ ...field, paddingRight: 40 }} value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
                {eye(showConf, () => setShowConf((v) => !v))}
              </div>
            </Fld>

            {err && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 10, padding: "10px 14px", color: "#fca5a5", fontSize: 13 }}>
                {err}
              </div>
            )}

            <button type="submit" disabled={busy}
              style={{ background: busy ? "rgba(201,162,39,0.5)" : "linear-gradient(135deg,#c9a227,#e8c84a)",
                color: "#0a1628", fontWeight: 700, fontSize: 14, border: "none", borderRadius: 10,
                padding: "11px 0", cursor: busy ? "default" : "pointer",
                boxShadow: busy ? "none" : "0 4px 20px rgba(201,162,39,0.3)" }}>
              {busy ? "Creating account…" : "Create Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
        color: "#7b8db0", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
      <span style={{ color: "#7b8db0", minWidth: 44 }}>{label}:</span>
      <span style={{ color: "#e8edf8", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
