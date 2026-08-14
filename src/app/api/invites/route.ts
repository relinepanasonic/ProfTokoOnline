import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

async function verifyAdmin(req: NextRequest) {
  const db = admin();
  const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;
  const { data: p } = await db.from("profiles").select("role,client_id").eq("id", user.id).single();
  if (!p || !["superadmin", "client_admin"].includes(p.role)) return null;
  return { user, role: p.role as string, client_id: p.client_id as string | null };
}

// GET — list invites. client_admin only sees their own tenant's invites;
// superadmin (global, client_id = null) sees everything.
export async function GET(req: NextRequest) {
  const caller = await verifyAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const db = admin();
  let q = db
    .from("invites")
    .select("id,token,owner_name,store_name,role,created_at,expires_at,used_at")
    .order("created_at", { ascending: false });
  if (caller.role === "client_admin") q = q.eq("client_id", caller.client_id);
  const { data } = await q;

  return NextResponse.json({ invites: data ?? [] });
}

// POST — create invite. client_admin ("Admin") is hard-locked to generating
// Owner (branch_manager) links for their own tenant only — never Superadmin,
// Admin, or Advertiser, and never another client_id, regardless of what the
// request body contains.
export async function POST(req: NextRequest) {
  const caller = await verifyAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json() as {
    owner_name: string; store_name?: string; role: string; username?: string | null;
    // Unclaimed-owner invites only (users/page.tsx "Unclaimed Owners" section):
    // client_id targets the owner's actual tenant (the manual "Invite User"
    // button never sends these — superadmin's own client_id is null, which
    // is the existing/legacy behavior for that flow and is left untouched).
    client_id?: string | null; plan_type?: string | null; duration_days?: number | null; lifetime?: boolean;
  };
  if (!body.owner_name?.trim()) return NextResponse.json({ error: "Owner name is required" }, { status: 400 });

  const isClientAdmin = caller.role === "client_admin";
  if (isClientAdmin && body.role && body.role !== "branch_manager") {
    return NextResponse.json({ error: "Admin may only generate Owner (Client Owner) invite links" }, { status: 403 });
  }

  const db = admin();
  const { data: inv, error } = await db
    .from("invites")
    .insert({
      owner_name: body.owner_name.trim(),
      store_name: body.store_name?.trim() || null,
      role:       isClientAdmin ? "branch_manager" : (body.role || "branch_manager"),
      username:   body.username?.trim() || null,
      client_id:  isClientAdmin ? caller.client_id : (body.client_id ?? caller.client_id),
      created_by: caller.user.id,
      plan_type:      body.plan_type ?? null,
      duration_days:  body.duration_days ?? null,
      ...(body.lifetime ? { expires_at: null } : {}),
    })
    .select("token")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: inv.token });
}

// DELETE — revoke invite. client_admin may only revoke their own tenant's invites.
export async function DELETE(req: NextRequest) {
  const caller = await verifyAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await req.json() as { id: string };
  const db = admin();
  if (caller.role === "client_admin") {
    const { data: target } = await db.from("invites").select("client_id").eq("id", id).single();
    if (!target || target.client_id !== caller.client_id) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
  }
  await db.from("invites").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
