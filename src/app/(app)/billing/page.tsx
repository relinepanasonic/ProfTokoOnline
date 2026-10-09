"use client";

// Owner-facing billing: buy / renew a plan by manual bank transfer (no
// payment gateway yet). Price, unique code and every state change happen
// inside SECURITY DEFINER RPCs (migration 0125) — this page only asks.
// An expired Owner can still reach it (layout.tsx keeps /billing in every
// self-serve plan's allowed pages), which is the whole point of it.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import { useLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// Bank details come from the billing_settings table (editable on /payments),
// not from Vercel env vars — see migration 0126.
type Bank = { name: string; account: string; holder: string; whatsapp: string };
const NO_BANK: Bank = { name: "", account: "", holder: "", whatsapp: "" };
const MONTH_OPTIONS = [1, 3, 6, 12];

type PlanRow = { plan_type: string; label: string; price_per_month: number };
type Req = {
  id: string; plan_type: string; months: number; base_amount: number; unique_code: number; amount: number;
  status: "pending" | "approved" | "rejected" | "expired"; proof_path: string | null; note: string | null;
  created_at: string; expires_at: string;
};
type Me = { id: string; role: string; plan_type: string | null; subscription_end: string | null };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDT = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function BillingPage() {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<Me | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [BANK, setBank] = useState<Bank>(NO_BANK);
  const [now, setNow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: p }, { data: pl }, { data: rq }, { data: bs }] = await Promise.all([
      supabase.from("profiles").select("id,role,plan_type,subscription_end").eq("id", user.id).single(),
      supabase.from("billing_plans").select("plan_type,label,price_per_month").eq("active", true).order("price_per_month"),
      supabase.from("payment_requests")
        .select("id,plan_type,months,base_amount,unique_code,amount,status,proof_path,note,created_at,expires_at")
        .eq("profile_id", user.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("billing_settings").select("bank_name,bank_account,bank_holder,whatsapp").eq("id", 1).maybeSingle(),
    ]);
    const b = bs as { bank_name: string; bank_account: string; bank_holder: string; whatsapp: string } | null;
    setBank(b ? { name: b.bank_name, account: b.bank_account, holder: b.bank_holder, whatsapp: b.whatsapp.replace(/\D/g, "") } : NO_BANK);
    setMe(p as Me | null);
    setPlans((pl as PlanRow[]) || []);
    setReqs((rq as Req[]) || []);
    setNow(Date.now());
    setLoading(false);
  }, [supabase]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (loading || !me || now == null) return <Loader center />;

  if (me.role !== "branch_manager") {
    return <div className="panel"><div className="hint">{t("Billing is for Owner accounts.")}</div></div>;
  }
  if (me.plan_type === "prof") {
    return <div className="panel"><div className="hint">{t("Your account is billed through consultation — nothing to pay here.")}</div></div>;
  }

  const endMs = me.subscription_end ? new Date(me.subscription_end).getTime() : null;
  const daysLeft = endMs == null ? null : Math.ceil((endMs - now) / 86_400_000);
  const expired = daysLeft != null && daysLeft <= 0;
  const open = reqs.find((r) => r.status === "pending" && new Date(r.expires_at).getTime() > now) || null;
  const plan = plans[0] || null; // only one sellable plan today (Price Calculator)

  async function call(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setMsg("");
    const { error } = await fn();
    setBusy(false);
    if (error) { setMsg("✗ " + error.message); return false; }
    await load();
    return true;
  }

  const createPayment = () => plan && call(() => supabase.rpc("request_payment", { p_plan: plan.plan_type, p_months: months }));
  const cancelPayment = (id: string) => call(() => supabase.rpc("cancel_payment", { p_id: id }));

  async function uploadProof(r: Req, file: File) {
    setBusy(true); setMsg("");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${me!.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file);
    if (upErr) { setBusy(false); setMsg("✗ " + upErr.message); return; }
    const { error } = await supabase.rpc("attach_payment_proof", { p_id: r.id, p_path: path });
    setBusy(false);
    if (error) { setMsg("✗ " + error.message); return; }
    load();
  }

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? "" : c)), 1500);
  }

  const statusLabel = (r: Req) =>
    r.status === "approved" ? t("Approved") : r.status === "rejected" ? t("Rejected")
    : r.status === "pending" && new Date(r.expires_at).getTime() > now ? t("Waiting for payment") : t("Expired");
  const statusColor = (r: Req) =>
    r.status === "approved" ? "#34d399" : r.status === "rejected" ? "#f87171"
    : r.status === "pending" && new Date(r.expires_at).getTime() > now ? "#fbbf24" : "var(--muted)";

  const waText = open
    ? encodeURIComponent(`Halo, saya sudah transfer ${rp(open.amount)} untuk paket ${plan?.label || open.plan_type} (${open.months} bulan).`)
    : "";

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      {/* Current plan */}
      <div className="panel">
        <h3 style={{ margin: "0 0 10px" }}>{t("Billing")}</h3>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
          <div><div className="hint">{t("Current plan")}</div><strong>{me.plan_type || "—"}</strong></div>
          <div>
            <div className="hint">{t("Status")}</div>
            <strong style={{ color: expired ? "#f87171" : daysLeft != null && daysLeft <= 7 ? "#fbbf24" : "#34d399" }}>
              {daysLeft == null ? t("Unlimited") : expired ? t("Expired") : `${daysLeft} ${t("days left")}`}
            </strong>
          </div>
          {me.subscription_end && <div><div className="hint">{t("Valid until")}</div><strong>{fmtDT(me.subscription_end)}</strong></div>}
        </div>
      </div>

      {msg && <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: 13, color: "#ff9a9a", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)" }}>{msg}</div>}

      {/* Open payment */}
      {open ? (
        <div className="panel" style={{ border: "1px solid rgba(201,162,39,.4)" }}>
          <h3 style={{ margin: "0 0 4px" }}>{t("Transfer exactly")}</h3>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--gold)", margin: "6px 0" }}>
            {rp(open.base_amount)}
            <span style={{ color: "#fff", background: "rgba(201,162,39,.25)", borderRadius: 8, padding: "0 8px", marginLeft: 6 }}>+ {open.unique_code}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 20 }}>{rp(open.amount)}</strong>
            <button className="btn-ghost" onClick={() => copy("amount", String(open.amount))}>{copied === "amount" ? t("Copied!") : t("Copy")}</button>
          </div>
          <div className="hint" style={{ margin: "6px 0 14px" }}>
            {t("The last digits are your unique code — they let us match your transfer. Please transfer the exact amount.")}
          </div>

          {BANK.account ? (
            <div style={{ display: "grid", gap: 6, fontSize: 14, marginBottom: 14 }}>
              <div><span className="hint">{t("Bank")}: </span><strong>{BANK.name}</strong></div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span><span className="hint">{t("Account number")}: </span><strong style={{ letterSpacing: 1 }}>{BANK.account}</strong></span>
                <button className="btn-ghost" onClick={() => copy("acc", BANK.account)}>{copied === "acc" ? t("Copied!") : t("Copy")}</button>
              </div>
              <div><span className="hint">{t("Account name")}: </span><strong>{BANK.holder}</strong></div>
            </div>
          ) : (
            <div className="hint" style={{ marginBottom: 14 }}>{t("Bank details are not set up yet — please contact us.")}</div>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Upload transfer proof")}</label>
            <input type="file" accept="image/*" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(open, f); e.target.value = ""; }} />
            {open.proof_path
              ? <div style={{ color: "#34d399", fontSize: 13 }}>✓ {t("Proof uploaded — waiting for approval.")}</div>
              : <div className="hint">{t("After you transfer, upload the screenshot so we can approve faster.")}</div>}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
            {BANK.whatsapp && (
              <a className="btn-gold" style={{ textDecoration: "none" }} target="_blank" rel="noreferrer"
                href={`https://wa.me/${BANK.whatsapp}?text=${waText}`}>{t("Confirm via WhatsApp")}</a>
            )}
            <button className="btn-ghost" disabled={busy} onClick={() => cancelPayment(open.id)}>{t("Cancel request")}</button>
            <span className="hint">{t("Request valid until")} {fmtDT(open.expires_at)}</span>
          </div>
        </div>
      ) : plan ? (
        <div className="panel">
          <h3 style={{ margin: "0 0 4px" }}>{plan.label}</h3>
          <div className="hint" style={{ marginBottom: 10 }}>{t("Opens the Price Calculator only.")}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--gold)" }}>
            {rp(plan.price_per_month)} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>{t("per month")}</span>
          </div>

          <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap", alignItems: "center" }}>
            <span className="hint">{t("Months")}:</span>
            {MONTH_OPTIONS.map((m) => (
              <button key={m} onClick={() => setMonths(m)}
                style={{ padding: "6px 14px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13,
                  border: `1px solid ${months === m ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
                  background: months === m ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
                  color: months === m ? "var(--navy-deep)" : "#cdd9f0" }}>{m}</button>
            ))}
            <strong style={{ marginLeft: 8 }}>{rp(plan.price_per_month * months)}</strong>
          </div>

          {me.plan_type && me.plan_type !== plan.plan_type && !expired && (
            <div className="hint" style={{ marginBottom: 12, color: "#fcd34d" }}>
              {t("Your current plan will be replaced by this plan once the payment is approved.")}
            </div>
          )}
          <button className="btn-gold" disabled={busy} onClick={createPayment}>{busy ? "…" : t("Create payment")}</button>
        </div>
      ) : null}

      {/* History */}
      {reqs.length > 0 && (
        <div className="panel">
          <h3 style={{ margin: "0 0 10px" }}>{t("Payment history")}</h3>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>{t("Date")}</th><th>{t("Plan")}</th><th>{t("Months")}</th><th className="num">{t("Amount")}</th><th>{t("Status")}</th></tr></thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDT(r.created_at)}</td>
                    <td>{r.plan_type}</td>
                    <td>{r.months}</td>
                    <td className="num">{rp(r.amount)}</td>
                    <td style={{ color: statusColor(r), fontWeight: 700 }}>
                      {statusLabel(r)}{r.status === "rejected" && r.note ? ` — ${r.note}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
