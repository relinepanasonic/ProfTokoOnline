import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

// GET /api/join?token=xxx — fetch invite details (public, no auth)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const db = admin();
  const { data: inv, error } = await db
    .from("invites")
    .select("owner_name,store_name,role,expires_at,used_at")
    .eq("token", token)
    .single();

  if (error || !inv) return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  if (inv.used_at)    return NextResponse.json({ error: "This invite has already been used" }, { status: 410 });
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: "This invite has expired" }, { status: 410 });

  // Also fetch pre-set username if stored in invite
  const { data: fullInv } = await db.from("invites").select("owner_name,store_name,role,expires_at,username").eq("token", token).single();
  return NextResponse.json({ invite: fullInv ?? inv });
}

// POST /api/join — register from invite (public, no auth)
export async function POST(req: NextRequest) {
  const body = await req.json() as { token: string; email: string; username: string; phone?: string; password: string };
  const { token, email, username, phone, password } = body;
  if (!token || !email || !username || !password)
    return NextResponse.json({ error: "token, email, username and password are required" }, { status: 400 });

  const db = admin();

  // Validate invite
  const { data: inv, error: ie } = await db
    .from("invites")
    .select("id,owner_name,store_name,role,client_id,used_at,expires_at")
    .eq("token", token)
    .single();

  if (ie || !inv) return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  if (inv.used_at) return NextResponse.json({ error: "This invite has already been used" }, { status: 410 });
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: "This invite link has expired" }, { status: 410 });

  // Check username not taken
  const { data: uCheck } = await db.from("profiles").select("id").ilike("username", username).maybeSingle();
  if (uCheck) return NextResponse.json({ error: "Username already taken" }, { status: 409 });

  // Create auth user
  const { data: authData, error: ae } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (ae || !authData.user) return NextResponse.json({ error: ae?.message ?? "Failed to create account" }, { status: 500 });

  const uid = authData.user.id;

  // Update profile (trigger creates the row; we patch it)
  const { error: pe } = await db.from("profiles").upsert({
    id:           uid,
    email:        email,
    display_name: inv.owner_name,
    username:     username,
    phone:        phone ?? null,
    role:         inv.role,
    client_id:    inv.client_id,
    scope_store:  inv.store_name ?? null,
  });

  if (pe) {
    await db.auth.admin.deleteUser(uid); // rollback
    return NextResponse.json({ error: pe.message }, { status: 500 });
  }

  // Mark invite used
  await db.from("invites").update({ used_at: new Date().toISOString(), used_by: uid }).eq("id", inv.id);

  return NextResponse.json({ ok: true });
}
