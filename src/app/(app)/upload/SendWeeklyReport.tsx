"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { safeJson } from "@/lib/safeJson";

type Preview = {
  store?: string; label?: string; client?: string; week?: { from: string; to: string };
  group?: string; status?: string; caption?: string; imageUrl?: string;
};
type Note = { kind: "ok" | "err"; text: string } | null;
type Retry = { sentAt?: string; action: "preview" | "send" } | null;

const NO_GROUP_TEXT = "This client has no WhatsApp group yet. Link it in the ERP (Optimizing > Clients)";

// "Send weekly report to client group (Oli)". The ERP builds the one-page image and sends it from Oli's
// number; this component only asks the ERP (through our server — the key never reaches the browser):
// first a preview, then, after the admin confirms, the send. Never retries by itself.
// The parent gives it key={store|week}, so choosing another store or week mounts it fresh (no stale preview).
export default function SendWeeklyReport({ store, week }: { store: string; week: string }) {
  const [busy, setBusy] = useState<"" | "preview" | "send">("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [noGroupFor, setNoGroupFor] = useState(false);
  const [again, setAgain] = useState<Retry>(null);
  const [resend, setResend] = useState(false);
  const lock = useRef(false);

  const noGroup = noGroupFor;

  async function call(action: "preview" | "send", resendFlag: boolean) {
    if (lock.current) return; // one request at a time, a double click can never send twice
    lock.current = true;
    setBusy(action); setNote(null);
    try {
      const res = await fetch("/api/wa/client-weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, ...(week ? { week } : {}), action, resend: resendFlag }),
      });
      let data: Record<string, unknown> = {};
      try { data = await safeJson(res); } catch (e) { data = { message: e instanceof Error ? e.message : "Unexpected answer" }; }
      const msg = typeof data.message === "string" ? data.message : "";

      if (res.ok && data.ok === true) {
        if (action === "preview") { setPreview(data as Preview); setAgain(null); }
        else {
          setPreview(null); setAgain(null); setResend(false);
          setNote({ kind: "ok", text: `✓ Sent ${fmtDateTime(new Date(), "Asia/Jakarta")}` });
        }
      } else if (res.status === 409 && data.error === "no_group") {
        setPreview(null); setNoGroupFor(true);
      } else if (res.status === 409 && data.error === "already_sent") {
        setAgain({ sentAt: typeof data.sentAt === "string" ? data.sentAt : undefined, action });
      } else if (res.status === 401) {
        setNote({ kind: "err", text: "Your session has expired — sign in again." });
      } else {
        setNote({ kind: "err", text: msg || `Something went wrong (${res.status}).` });
      }
    } catch {
      setNote({ kind: "err", text: "Network error. Nothing was sent — check the connection and try again." });
    } finally {
      lock.current = false;
      setBusy("");
    }
  }

  function sendAgain() {
    if (!again) return;
    setResend(true);
    call(again.action, true);
  }

  const alreadySentLine = again && (
    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13, color: "var(--gold)" }}>
      <span>Already sent on {again.sentAt ? fmtDateTime(again.sentAt, "Asia/Jakarta") : "an earlier date"}</span>
      <button type="button" onClick={sendAgain} disabled={!!busy}
        style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid var(--gold)", background: "transparent", color: "var(--gold)", fontWeight: 700, fontSize: 12.5, cursor: busy ? "default" : "pointer" }}>
        {busy ? "…" : "Send again"}
      </button>
    </div>
  );

  return (
    <div style={{ marginTop: 18, padding: 16, border: "1px dashed rgba(201,162,39,.35)", borderRadius: 14, background: "rgba(15,32,64,.4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button className="btn-gold" type="button" disabled={!store || !!busy || noGroup}
          onClick={() => call("preview", resend)} style={{ padding: "10px 22px", fontSize: 14 }}>
          {busy === "preview" ? "Preparing preview…" : "Send weekly report to client group (Oli)"}
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {!store ? "Select a store first." : week ? `Week of ${fmtDate(week)}` : "Last full week"}
        </span>
      </div>

      {noGroup && <div style={{ marginTop: 10, fontSize: 13, color: "#fbbf24" }}>{NO_GROUP_TEXT}</div>}
      {!preview && alreadySentLine}
      {note && (
        <div style={{ marginTop: 10, fontSize: 13, color: note.kind === "ok" ? "var(--gold)" : "#f87171" }}>{note.text}</div>
      )}

      {preview && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(3,8,18,.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ width: "min(560px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "var(--navy-deep, #0b1830)", border: "1px solid rgba(201,162,39,.45)", borderRadius: 16, padding: 20 }}>
            <h3 style={{ margin: "0 0 4px" }}>Send this report?</h3>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
              {preview.label || preview.store || store}
              {preview.week && <> · {fmtDate(preview.week.from)} – {fmtDate(preview.week.to)}</>}
            </div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              To WhatsApp group: <b style={{ color: "var(--gold)" }}>{preview.group || "—"}</b>
            </div>
            {typeof preview.imageUrl === "string" && preview.imageUrl.startsWith("https://") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.imageUrl} alt="Weekly report preview" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "#fff", marginBottom: 12 }} />
            )}
            {preview.caption && (
              <div style={{ whiteSpace: "pre-wrap", fontSize: 13, background: "rgba(10,22,40,.6)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                {preview.caption}
              </div>
            )}
            {note?.kind === "err" && <div style={{ fontSize: 13, color: "#f87171", marginBottom: 10 }}>{note.text}</div>}
            {alreadySentLine}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button type="button" disabled={!!busy} onClick={() => { setPreview(null); setNote(null); }}
                style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid var(--line)", background: "transparent", color: "#cdd9f0", cursor: busy ? "default" : "pointer" }}>
                Cancel
              </button>
              <button type="button" className="btn-gold" disabled={!!busy || !!again} onClick={() => call("send", resend)} style={{ padding: "9px 26px" }}>
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
