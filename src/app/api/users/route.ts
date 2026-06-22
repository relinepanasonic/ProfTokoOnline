import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Caller = { id: string; role: string; client_id: string | null };

// Verify the caller and return their profile, or null if not allowed to manage users.
async function getManager(): Promise<Caller | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase
    .from("profiles").select("role, client_id").eq("id", user.id).single();
  if (!p) return null;
  if (!["superadmin", "client_admin"].includes(p.role)) return null;
  return { id: user.id, role: p.role, client_id: p.client_id };
}

// Resolve which client the new/edited user belongs to + guard role escalation.
function resolveClient(mgr: Caller, bodyClientId?: string, targetRole?: string): string | null | "ERR" {
  if (mgr.role === "superadmin") return bodyClientId ?? null;
  // client_admin: locked to own client and cannot create superadmins
  if (targetRole === "superadmin") return "ERR";
  return mgr.client_id;
}

export async function POST(req: NextRequest) {
  const mgr = await getManager();
  if (!mgr) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const b = await req.json();
  const { email, password, display_name, role, scope_city, scope_store } = b;
  if (!email || !password || !role)
    return NextResponse.json({ error: "Missing email, password or role" }, { status: 400 });

  const clientId = resolveClient(mgr, b.client_id, role);
  if (clientId === "ERR") return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (role !== "superadmin" && !clientId)
    return NextResponse.json({ error: "client_id required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr || !created.user)
    return NextResponse.json({ error: cErr?.message || "create failed" }, { status: 400 });

  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id,
    email,
    display_name: display_name || null,
    role,
    client_id: role === "superadmin" ? null : clientId,
    scope_city: role === "branch_manager" ? scope_city || null : null,
    scope_store: role === "store_user" ? scope_store || null : null,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id); // rollback
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: created.user.id });
}

export async function PATCH(req: NextRequest) {
  const mgr = await getManager();
  if (!mgr) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const b = await req.json();
  const { id, display_name, role, scope_city, scope_store, password } = b;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();

  // client_admin may only edit users within their own client
  if (mgr.role === "client_admin") {
    const { data: target } = await admin.from("profiles").select("client_id").eq("id", id).single();
    if (!target || target.client_id !== mgr.client_id || role === "superadmin")
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (display_name !== undefined) patch.display_name = display_name;
  if (role !== undefined) {
    patch.role = role;
    patch.scope_city = role === "branch_manager" ? scope_city || null : null;
    patch.scope_store = role === "store_user" ? scope_store || null : null;
  }
  if (Object.keys(patch).length) {
    const { error } = await admin.from("profiles").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (password) {
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const mgr = await getManager();
  if (!mgr) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (id === mgr.id) return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });

  const admin = createAdminClient();
  if (mgr.role === "client_admin") {
    const { data: target } = await admin.from("profiles").select("client_id").eq("id", id).single();
    if (!target || target.client_id !== mgr.client_id)
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const { error } = await admin.auth.admin.deleteUser(id); // cascades profile
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
