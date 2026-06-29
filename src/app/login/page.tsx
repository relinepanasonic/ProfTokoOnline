"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    // If no "@", treat as username and look up the email first
    let email = identifier.trim();
    if (!email.includes("@")) {
      const { data, error: rpcErr } = await supabase.rpc("get_email_by_username", {
        p_username: email,
      });
      if (rpcErr || !data) {
        setError("Username not found");
        setLoading(false);
        return;
      }
      email = data as string;
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInErr) { setError(signInErr.message); return; }
    router.replace("/");
    router.refresh();
  }

  const fieldStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#e8edf8",
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "linear-gradient(135deg, #0a1628 0%, #0f2040 50%, #1a3461 100%)" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position: "absolute", top: "-20%", right: "-10%", width: 600, height: 600, borderRadius: "50%", border: "1px solid rgba(201,162,39,0.08)" }} />
        <div style={{ position: "absolute", top: "-10%", right: "-5%",  width: 400, height: 400, borderRadius: "50%", border: "1px solid rgba(201,162,39,0.12)" }} />
        <div style={{ position: "absolute", bottom: "-20%", left: "-10%", width: 500, height: 500, borderRadius: "50%", border: "1px solid rgba(201,162,39,0.06)" }} />
      </div>

      <form
        onSubmit={onSubmit}
        className="glass relative w-full max-w-sm rounded-2xl p-8"
        style={{ boxShadow: "0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,162,39,0.1)" }}
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <img src="/logo.svg" alt="ProfTokoOnline" style={{ width: 90, height: 90, objectFit: "contain" }} />
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-wide" style={{ color: "#e8edf8" }}>ProfTokoOnline</h1>
            <p className="mt-0.5 text-xs" style={{ color: "#7b8db0" }}>Dashboard Analytics</p>
          </div>
        </div>

        <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(201,162,39,0.3), transparent)", marginBottom: 24 }} />

        <div className="space-y-4">
          {/* Username or Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: "#7b8db0" }}>
              Username or Email
            </label>
            <input
              type="text"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="username or email"
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
              style={fieldStyle}
              onFocus={(e) => (e.target.style.borderColor = "rgba(201,162,39,0.5)")}
              onBlur={(e)  => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
            />
          </div>

          {/* Password with reveal toggle */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-widest" style={{ color: "#7b8db0" }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all"
                style={{ ...fieldStyle, paddingRight: 44 }}
                onFocus={(e) => (e.target.style.borderColor = "rgba(201,162,39,0.5)")}
                onBlur={(e)  => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#7b8db0", padding: 0, lineHeight: 1 }}
              >
                {showPass ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg px-4 py-2.5 text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-semibold tracking-wide transition-all"
            style={{ background: loading ? "rgba(201,162,39,0.5)" : "linear-gradient(135deg, #c9a227, #e8c84a)", color: "#0a1628", boxShadow: loading ? "none" : "0 4px 20px rgba(201,162,39,0.3)" }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: "#4a5d7a" }}>
          © {new Date().getFullYear()} ProfTokoOnline
        </p>
      </form>
    </div>
  );
}
