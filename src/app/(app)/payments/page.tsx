"use client";

// Superadmin-only: approve / reject transfer proofs, and see who is about
// to expire so you can remind them. Approving runs approve_payment()
// (migration 0125), which sets the plan and extends subscription_end
// server-side — nothing here computes dates itself. layout.tsx's route
// guard keeps /payments superadmin-only, and the RPCs re-check the role.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";

type Prof = { display_name: string | null; scope_owner: string | null; username: string | null; phone: string | null } | null;
type Req = {
  id: string; plan_type: string; months: number; amount: number; unique_code: number;
  status: "pending" | "approved" | "rejected" | "expired"; proof_path: string | null; note: string | null;
  created_at: string; expires_at: string; reviewed_at: string | null; profile: Prof;
};
type Expiring = { id: string; display_name: string | null; scope_owner: string | null; phone: string | null; plan_type: string | null; subscription_end: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDT = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const who = (p: Prof) => p?.display_name || p?.scope_owner || p?.username || "—";
// 08xx… -> 628xx… for wa.me
const waNumber = (phone: string | null) => {
  const d = (phone || "").replace(/\D/g, "");
  return d.startsWith("0") ? "62" + d.slice(1) : d;
};

export default function PaymentsPage() {
  const [supabase] = useState(() => createClient());
  const [reqs, setReqs] = useState<Req[]>([]);
  const [expiring, setExpiring] = useState<Expiring[]>([]);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [now, setNow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState("");
  const [bank, setBank] = useState({ bank_name: "", bank_account: "", bank_holder: "", whatsapp: "" });
  const [bankMsg, setBankMsg] = useState("");

  const load = useCallback(async () => {
    const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const [{ data: rq }, { data: ex }, { data: bs }] = await Promise.all([
      supabase.from("payment_requests")
        .select("id,plan_type,months,amount,unique_code,status,proof_path,note,created_at,expires_at,reviewed_at,profile:profiles!payment_requests_profile_id_fkey(display_name,scope_owner,username,phone)")
        .order("created_at", { ascending: false }).limit(60),
      supabase.from("profiles")
        .select("id,display_name,scope_owner,phone,plan_type,subscription_end")
        .eq("role", "branch_manager").neq("plan_type", "prof").not("subscription_end", "is", null)
        .lte("subscription_end", soon).order("subscription_end"),
      supabase.from("billing_settings").select("bank_name,bank_account,bank_holder,whatsapp").eq("id", 1).maybeSingle(),
    ]);
    if (bs) setBank(bs as typeof bank);
    const rows = (rq as unknown as Req[]) || [];
    setReqs(rows);
    setExpiring((ex as Expiring[]) || []);
    const urls: Record<string, string> = {};
    await Promise.all(rows.filter((r) => r.proof_path).map(async (r) => {
      const { data } = await supabase.storage.from("payment-proofs").createSignedUrl(r.proof_path as string, 900);
      if (data?.signedUrl) urls[r.id] = data.signedUrl;
    }));
    setProofUrls(urls);
    setNow(Date.now());
    setLoading(false);
  }, [supabase]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function saveBank() {
    setBankMsg("");
    const { error } = await supabase.from("billing_settings")
      .update({ ...bank, updated_at: new Date().toISOString() }).eq("id", 1);
    setBankMsg(error ? "✗ " + error.message : "✓ Saved — customers see this on their Billing page now.");
  }

  async function approve(r: Req) {
    if (!confirm(`Approve ${rp(r.amount)} from ${who(r.profile)}? This sets their plan and extends it by ${r.months} month(s).`)) return;
    setBusyId(r.id); setMsg("");
    const { error } = await supabase.rpc("approve_payment", { p_id: r.id });
    setBusyId("");
    if (error) setMsg("✗ " + error.message); else load();
  }
  async function reject(r: Req) {
    const note = prompt("Reason for rejecting (shown to the customer):", "Transfer not found");
    if (note === null) return;
    setBusyId(r.id); setMsg("");
    const { error } = await supabase.rpc("reject_payment", { p_id: r.id, p_note: note || null });
    setBusyId("");
    if (error) setMsg("✗ " + error.message); else load();
  }

  if (loading || now == null) return <Loader center />;

  const pending = reqs.filter((r) => r.status === "pending");
  const history = reqs.filter((r) => r.status !== "pending");
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - now) / 86_400_000);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, color: "#ff9a9a", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)" }}>{msg}</div>}

      <div className="panel">
        <h3 style={{ margin: "0 0 4px" }}>Payment details</h3>
        <div className="hint" style={{ marginBottom: 10 }}>Shown to customers on their Billing page. Saved straight to the database — no redeploy needed.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          {([
            ["bank_name", "Bank", "e.g. BCA"],
            ["bank_account", "Account number", "digits only"],
            ["bank_holder", "Account name", "name on the account"],
            ["whatsapp", "WhatsApp (optional)", "628123456789"],
          ] as const).map(([k, label, ph]) => (
            <div className="fld" key={k}>
              <label>{label}</label>
              <input type="text" value={bank[k]} placeholder={ph}
                onChange={(e) => setBank((b) => ({ ...b, [k]: e.target.value }))}
                style={{ background: "rgba(10,22,40,.5)", border: "1px solid rgba(201,162,39,.2)", borderRadius: 8, padding: "8px 10px", color: "#e8edf8", fontSize: 13, width: "100%" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <button className="btn-gold" onClick={saveBank}>Save</button>
          {bankMsg && <span style={{ fontSize: 13, color: bankMsg.startsWith("✓") ? "#86efac" : "#ff9a9a" }}>{bankMsg}</span>}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 4px" }}>Waiting for approval <span className="hint">({pending.length})</span></h3>
        <div className="hint" style={{ marginBottom: 10 }}>
          Match the exact amount (including the unique code) against your bank statement before approving.
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Requested</th><th>Customer</th><th>Plan</th><th className="num">Amount</th><th>Proof</th><th></th></tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDT(r.created_at)}<div className="hint">expires {fmtDT(r.expires_at)}</div></td>
                  <td>{who(r.profile)}</td>
                  <td>{r.plan_type} · {r.months} mo</td>
                  <td className="num" style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{rp(r.amount)}</td>
                  <td>
                    {proofUrls[r.id]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <a href={proofUrls[r.id]} target="_blank" rel="noreferrer"><img src={proofUrls[r.id]} alt="proof" style={{ height: 54, borderRadius: 6, border: "1px solid var(--line)" }} /></a>
                      : <span className="hint">no proof yet</span>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn-gold" disabled={busyId === r.id} onClick={() => approve(r)}>Approve</button>{" "}
                    <button className="btn-ghost" disabled={busyId === r.id} onClick={() => reject(r)}>Reject</button>
                  </td>
                </tr>
              ))}
              {!pending.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>Nothing waiting.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 4px" }}>Expiring in 7 days or already expired <span className="hint">({expiring.length})</span></h3>
        <div className="hint" style={{ marginBottom: 10 }}>Client (agency-managed) accounts are not listed — they are billed through consultation.</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Owner</th><th>Plan</th><th>Ends</th><th>Days</th><th></th></tr></thead>
            <tbody>
              {expiring.map((e) => {
                const d = daysLeft(e.subscription_end);
                const wa = waNumber(e.phone);
                const text = encodeURIComponent(
                  d <= 0
                    ? `Halo ${e.display_name || ""}, paket Prof Toko Online Anda sudah berakhir. Perpanjang di menu Billing ya.`
                    : `Halo ${e.display_name || ""}, paket Prof Toko Online Anda berakhir ${d} hari lagi. Perpanjang di menu Billing ya.`);
                return (
                  <tr key={e.id}>
                    <td>{e.display_name || e.scope_owner || "—"}</td>
                    <td>{e.plan_type}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(e.subscription_end)}</td>
                    <td style={{ fontWeight: 700, color: d <= 0 ? "#f87171" : d <= 3 ? "#fbbf24" : "var(--muted)" }}>{d <= 0 ? "expired" : `${d}d`}</td>
                    <td>{wa ? <a className="btn-ghost" style={{ textDecoration: "none" }} target="_blank" rel="noreferrer" href={`https://wa.me/${wa}?text=${text}`}>WhatsApp</a> : <span className="hint">no phone</span>}</td>
                  </tr>
                );
              })}
              {!expiring.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No one is close to expiring.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 10px" }}>Recent</h3>
        <div className="tbl-wrap" style={{ maxHeight: 360 }}>
          <table className="tbl">
            <thead><tr><th>Requested</th><th>Customer</th><th>Plan</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDT(r.created_at)}</td>
                  <td>{who(r.profile)}</td>
                  <td>{r.plan_type} · {r.months} mo</td>
                  <td className="num">{rp(r.amount)}</td>
                  <td style={{ fontWeight: 700, color: r.status === "approved" ? "#34d399" : r.status === "rejected" ? "#f87171" : "var(--muted)" }}>
                    {r.status}{r.note ? ` — ${r.note}` : ""}
                  </td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>No history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
