"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    nama: "", username: "", no_hp: "", email: "",
    password: "", confirm: "", brand: "", nama_toko: "",
  });
  const [showPass, setShowPass] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  // Live username availability, debounced.
  const [unameStatus, setUnameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const unameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (unameTimer.current) clearTimeout(unameTimer.current);
    const u = form.username.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!u) { setUnameStatus("idle"); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(u)) { setUnameStatus("idle"); return; }
    setUnameStatus("checking");
    unameTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/register?username=${encodeURIComponent(u)}`);
        const j = await res.json();
        setUnameStatus(j.available ? "available" : "taken");
      } catch { setUnameStatus("idle"); }
    }, 450);
    return () => { if (unameTimer.current) clearTimeout(unameTimer.current); };
  }, [form.username]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (form.password !== form.confirm) { setErr("Passwords do not match"); return; }
    if (form.password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    if (!/^[a-zA-Z0-9_.-]+$/.test(form.username)) { setErr("Username may only contain letters, numbers, _ . and -"); return; }
    if (unameStatus === "taken") { setErr("Username already taken"); return; }

    setBusy(true);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nama: form.nama, username: form.username, no_hp: form.no_hp,
        email: form.email, password: form.password,
        brand: form.brand, nama_toko: form.nama_toko,
      }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error || "Registration failed"); setBusy(false); return; }

    const supabase = createClient();
    await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
    setDone(true);
    setTimeout(() => router.replace("/"), 1800);
  }

  const field: React.CSSProperties = {
    width: "100%", padding: "8px 11px", borderRadius: 9,
    border: "1px solid rgba(201,162,39,.22)", background: "rgba(10,22,40,.6)",
    color: "#e8edf8", fontSize: 12.5, outline: "none",
  };
  const eye = (show: boolean, toggle: () => void) => (
    <button type="button" tabIndex={-1} onClick={toggle}
      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
               background: "none", border: "none", cursor: "pointer", color: "#7b8db0", padding: 0, lineHeight: 1 }}>
      {show ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #1a3461 100%)" }}>

      <div style={{ width: "100%", maxWidth: 380, background: "rgba(15,32,64,0.85)",
        border: "1px solid rgba(201,162,39,0.15)", borderRadius: 18, padding: 26,
        boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <Image src="/logo.png" alt="ProfTokoOnline" width={56} height={56} style={{ objectFit: "contain" }} priority />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#e8edf8" }}>ProfTokoOnline</div>
            <div style={{ fontSize: 11, color: "#7b8db0", marginTop: 2 }}>Create your account — 30 days Sultan free trial</div>
          </div>
        </div>

        <div style={{ height: 1, background: "linear-gradient(90deg,transparent,rgba(201,162,39,0.3),transparent)", marginBottom: 18 }} />

        {done ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
            <div style={{ color: "#e8edf8", fontWeight: 600, marginBottom: 5, fontSize: 14 }}>Account created!</div>
            <div style={{ color: "#7b8db0", fontSize: 12.5 }}>Redirecting to dashboard…</div>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "grid", gap: 11 }}>
            <Fld label="Nama">
              <input required style={field} placeholder="Nama lengkap"
                value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
            </Fld>
            <Fld label="Username">
              <div style={{ position: "relative" }}>
                <input required autoComplete="username" style={{ ...field, paddingRight: 60 }} placeholder="e.g. yunita_owner"
                  value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10.5, fontWeight: 700,
                  color: unameStatus === "available" ? "#34d399" : unameStatus === "taken" ? "#f87171" : "#7b8db0" }}>
                  {unameStatus === "checking" ? "…" : unameStatus === "available" ? "✓ free" : unameStatus === "taken" ? "✗ taken" : ""}
                </span>
              </div>
            </Fld>
            <Fld label="No HP">
              <input required type="tel" autoComplete="tel" style={field} placeholder="08xxxxxxxxxx"
                value={form.no_hp} onChange={(e) => setForm({ ...form, no_hp: e.target.value })} />
            </Fld>
            <Fld label="Email">
              <input required type="email" autoComplete="email" style={field} placeholder="your@email.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Fld>
            <Fld label="Brand">
              <input required style={field} placeholder="e.g. Nuphy"
                value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
            </Fld>
            <Fld label="Nama Toko">
              <input required style={field} placeholder="e.g. nuphyindonesia"
                value={form.nama_toko} onChange={(e) => setForm({ ...form, nama_toko: e.target.value })} />
            </Fld>
            <Fld label="Password">
              <div style={{ position: "relative" }}>
                <input required type={showPass ? "text" : "password"} autoComplete="new-password"
                  style={{ ...field, paddingRight: 36 }} placeholder="minimum 6 characters"
                  value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                {eye(showPass, () => setShowPass((v) => !v))}
              </div>
            </Fld>
            <Fld label="Confirm Password">
              <div style={{ position: "relative" }}>
                <input required type={showConf ? "text" : "password"} autoComplete="new-password"
                  style={{ ...field, paddingRight: 36 }} placeholder="repeat password"
                  value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
                {eye(showConf, () => setShowConf((v) => !v))}
              </div>
            </Fld>

            {err && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 9, padding: "9px 12px", color: "#fca5a5", fontSize: 12.5 }}>
                {err}
              </div>
            )}

            <button type="submit" disabled={busy}
              style={{ background: busy ? "rgba(201,162,39,0.5)" : "linear-gradient(135deg,#c9a227,#e8c84a)",
                color: "#0a1628", fontWeight: 700, fontSize: 13.5, border: "none", borderRadius: 9,
                padding: "10px 0", cursor: busy ? "default" : "pointer", marginTop: 3,
                boxShadow: busy ? "none" : "0 4px 20px rgba(201,162,39,0.3)" }}>
              {busy ? "Creating account…" : "Create Account"}
            </button>

            <button type="button" onClick={() => router.push("/login")}
              style={{ background: "none", border: "none", color: "#7b8db0", fontSize: 12, cursor: "pointer", padding: "2px 0" }}>
              Already have an account? <span style={{ color: "#c9a227", fontWeight: 600 }}>Sign in</span>
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
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em",
        color: "#7b8db0", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
