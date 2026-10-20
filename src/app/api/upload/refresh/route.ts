import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUploadRefresh, type RefreshSource } from "@/lib/uploadRefresh";

export const runtime = "nodejs";
export const maxDuration = 60;

// Second half of an upload: recompute the derived dashboard tables for the slice a finished
// /api/upload call just saved. It is its own request so it gets its own 60 s budget (a big SPOS
// file used to spend the whole budget of one request on parsing + inserting + both refreshes).
// Idempotent: safe to call again if it failed or the tab was closed.
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("Upload refresh crashed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "An error occurred" }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("client_id, role, scope_owner, plan_type, subscription_end").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "NO_PROFILE" }, { status: 403 });
  const isOwner = profile.role === "branch_manager";
  if (!["superadmin", "client_admin"].includes(profile.role) && !isOwner) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (isOwner) {
    const active = !!profile.plan_type && (!profile.subscription_end || new Date(profile.subscription_end) > new Date());
    if (!active) return NextResponse.json({ error: "SUBSCRIPTION_INACTIVE" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const uploadId = String(body?.upload_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return NextResponse.json({ error: "BAD_UPLOAD_ID" }, { status: 400 });

  const admin = createAdminClient();
  const { data: upload } = await admin.from("uploads").select("id, client_id, source, meta").eq("id", uploadId).maybeSingle();
  if (!upload) return NextResponse.json({ error: "UPLOAD_NOT_FOUND" }, { status: 404 });
  if (!["spos", "ads", "perf"].includes(upload.source)) return NextResponse.json({ error: "BAD_SOURCE" }, { status: 400 });

  // An Owner may only refresh uploads of their own client AND of a store in their own scope —
  // the same rule /api/upload applied when the rows were saved.
  const meta = (upload.meta || {}) as { year?: number; bulan?: string; week?: string; store_name?: string };
  if (isOwner) {
    if (upload.client_id !== profile.client_id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const { data: owned } = await supabase.from("store_links").select("store_name")
      .eq("client_id", upload.client_id).eq("owner", profile.scope_owner).eq("store_name", meta.store_name ?? "").maybeSingle();
    if (!owned) return NextResponse.json({ error: "STORE_NOT_IN_SCOPE" }, { status: 403 });
  }

  const warnings = await runUploadRefresh(admin, {
    clientId: upload.client_id,
    source: upload.source as RefreshSource,
    uploadId: upload.id,
    slice: { year: meta.year ?? null, month: meta.bulan ?? null, week: meta.week ?? null, store_name: meta.store_name ?? null },
  });
  return NextResponse.json({ ok: true, ...(warnings.length ? { rollup_warning: warnings.join("; ") } : {}) });
}
