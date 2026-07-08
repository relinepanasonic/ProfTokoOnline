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

// Only branch_manager / store_user are client-scoped. superadmin & client_admin
// are global (see/edit all clients) so they carry no client_id.
function isScopedRole(role?: string) {
  return role === "branch_manager" || role === "store_user";
}

// Resolve which client the new/edited user belongs to + guard role escalation.
function resolveClient(mgr: Caller, bodyClientId?: string, targetRole?: string): string | null | "ERR" {
  // only superadmin may create another superadmin
  if (targetRole === "superadmin" && mgr.role !== "superadmin") return "ERR";
  if (!isScopedRole(targetRole)) return null; // global roles carry no client
  if (mgr.role === "superadmin") return bodyClientId ?? null;
  return bodyClientId ?? mgr.client_id;
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
  if (isScopedRole(role) && !clientId)
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
    client_id: isScopedRole(role) ? clientId : null,
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

  // client_admin is global but may never touch superadmins (neither target nor target role)
  if (mgr.role === "client_admin") {
    const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
    if (!target || target.role === "superadmin" || role === "superadmin")
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

// PUT /api/users — set an Owner's subscription tier + duration.
// Superadmin only. days > 0 → expires now()+days; days = 0/blank → unlimited.
const VALID_TIERS = ["signup", "juragan", "sultan", "king", "free_trial"];
export async function PUT(req: NextRequest) {
  const mgr = await getManager();
  if (!mgr || mgr.role !== "superadmin")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id, tier, days } = await req.json() as { id: string; tier: string; days?: number };
  if (!id || !VALID_TIERS.includes(tier))
    return NextResponse.json({ error: "id and a valid tier are required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (!target || target.role !== "branch_manager")
    return NextResponse.json({ error: "Subscriptions apply to Owner accounts only" }, { status: 400 });

  // signup = reset to pending (no dates). Otherwise start the countdown now.
  const patch: Record<string, unknown> =
    tier === "signup"
      ? { tier: "signup", sub_started_at: null, sub_expires_at: null }
      : {
          tier,
          sub_started_at: new Date().toISOString(),
          sub_expires_at: days && days > 0
            ? new Date(Date.now() + days * 86_400_000).toISOString()
            : null,
        };

  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
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
    const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
    if (!target || target.role === "superadmin")
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const { error } = await admin.auth.admin.deleteUser(id); // cascades profile
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
