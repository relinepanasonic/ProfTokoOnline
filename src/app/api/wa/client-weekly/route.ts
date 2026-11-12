import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NO_STORE } from "@/lib/erpAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// =====================================================================
// POST /api/wa/client-weekly   { store, week?, action: "preview" | "send", resend? }
//
// The admin's "Send weekly report to client group (Oli)" button. This route calls the ERP
// (POST {ERP_BASE_URL}/api/v1/erp/wa/client-weekly) from the SERVER, so ERP_API_KEY never reaches
// the browser.
//
// NOT under /api/erp/*: that prefix skips the login check (it is for the ERP calling us). This one
// requires a signed-in admin (superadmin / client_admin / advertiser — the roles that upload the
// weekly numbers) and a store of the Prof Toko Online tenant.
//
// Never retries: a send is a deliberate click, and a second click is a deliberate "Send again".
// =====================================================================

const ERP_BASE_URL = (process.env.ERP_BASE_URL || "https://erp.profesoronline.id").replace(/\/+$/, "");
const ERP_CLIENT_ID = process.env.ERP_CLIENT_ID || "92213048-a91b-4202-9b47-8d1c38671082"; // Prof Toko Online
const ALLOWED_ROLES = ["superadmin", "client_admin", "advertiser"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ERP_TIMEOUT_MS = 50_000;

function validMonday(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s && new Date(t).getUTCDay() === 1;
}

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "AUTH_REQUIRED" }, 401);

  const { data: p } = await supabase.from("profiles").select("role,display_name,email").eq("id", user.id).single();
  const profile = p as { role: string; display_name: string | null; email: string | null } | null;
  if (!profile || !ALLOWED_ROLES.includes(profile.role)) return json({ error: "FORBIDDEN" }, 403);

  let body: { store?: unknown; week?: unknown; action?: unknown; resend?: unknown };
  try { body = await req.json(); } catch { return json({ error: "bad_request", message: "Invalid JSON" }, 400); }

  const store = typeof body.store === "string" ? body.store.trim() : "";
  if (!store || store.length > 200) return json({ error: "bad_request", message: "store is required" }, 400);
  const action = body.action;
  if (action !== "preview" && action !== "send") return json({ error: "bad_request", message: 'action must be "preview" or "send"' }, 400);
  const week = typeof body.week === "string" && body.week ? body.week : undefined;
  if (week && !validMonday(week)) return json({ error: "bad_request", message: "week must be a Monday, as YYYY-MM-DD" }, 400);
  const resend = body.resend === true;

  // The store must be one of this tenant's stores (RLS also applies to this user-scoped query).
  const { data: link } = await supabase.from("store_links")
    .select("store_name").eq("client_id", ERP_CLIENT_ID).eq("store_name", store).limit(1);
  if (!link || link.length === 0) return json({ error: "bad_request", message: "Unknown store" }, 400);

  const key = process.env.ERP_API_KEY;
  if (!key) {
    console.error("client-weekly: ERP_API_KEY is not set");
    return json({ error: "not_configured", message: "ERP connection is not configured" }, 500);
  }

  const sentBy = (profile.display_name || profile.email?.split("@")[0] || "Admin").slice(0, 80);
  const payload: Record<string, unknown> = { source: "dashboard", store, workspace: "", action, resend, sentBy };
  if (week) payload.week = week;

  let res: Response;
  try {
    res = await fetch(`${ERP_BASE_URL}/api/v1/erp/wa/client-weekly`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual", // never let the Bearer key follow a redirect to another host
      cache: "no-store",
      signal: AbortSignal.timeout(ERP_TIMEOUT_MS),
    });
  } catch (e) {
    console.error("client-weekly: ERP unreachable:", e instanceof Error ? e.message : e);
    return json({ error: "erp_unreachable", message: "Could not reach the ERP. Nothing was sent — try again." }, 502);
  }

  let data: Record<string, unknown> = {};
  try { data = (await res.json()) as Record<string, unknown>; } catch { /* empty body (401) or not JSON */ }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  if (res.status === 200 && data.ok === true) {
    // Pass on only the documented fields.
    return json({
      ok: true, store: data.store, label: data.label, client: data.client, week: data.week, group: data.group,
      status: data.status, caption: data.caption, imageUrl: data.imageUrl,
      ...(data.sent === true ? { sent: true, detail: data.detail } : {}),
    }, 200);
  }
  if (res.status === 401) {
    console.error("client-weekly: the ERP rejected ERP_API_KEY");
    return json({ error: "erp_auth", message: "The ERP rejected the connection key. Ask the admin to check ERP_API_KEY." }, 502);
  }
  if (res.status === 409 && data.error === "already_sent") return json({ error: "already_sent", sentAt: str(data.sentAt) }, 409);
  if (res.status === 409) return json({ error: "no_group" }, 409);
  if (res.status === 404) return json({ error: "no_data", message: str(data.message) || "No numbers for that store and week yet. Upload first." }, 404);
  if (res.status === 400) return json({ error: "bad_request", message: str(data.message) || "Bad request" }, 400);
  if (res.status === 502) return json({ error: "send_failed", message: str(data.message) || "WhatsApp refused the message." }, 502);

  console.error("client-weekly: unexpected ERP answer", res.status);
  return json({ error: "erp_error", message: `Unexpected answer from the ERP (${res.status}).` }, 502);
}
