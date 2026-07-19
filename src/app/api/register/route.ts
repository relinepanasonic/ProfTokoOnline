import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

// GET /api/register?username=xxx — live availability check (public, no
// auth). Needed because anon reads on profiles are RLS-blocked (there's no
// row an unauthenticated visitor can see), so the browser can't check this
// directly — only a friendlier UX than waiting for the submit error.
export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username")?.trim() || "";
  if (!username || !/^[a-zA-Z0-9_.-]+$/.test(username))
    return NextResponse.json({ available: false });
  const { data } = await admin().from("profiles").select("id").ilike("username", username).maybeSingle();
  return NextResponse.json({ available: !data });
}

// POST /api/register — public self-serve signup (no auth). Creates a
// brand-new, fully isolated tenant for the signer: a `clients` row, their
// first `store_links` entry, and a `branch_manager` profile on a 30-day
// Sultan trial — all atomically via provision_tenant() so there's never a
// half-created tenant. Role and plan are hardcoded here, never taken from
// the request body — the client cannot choose its own role or tenant.
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    nama: string; username: string; no_hp: string; email: string;
    password: string; brand: string; nama_toko: string;
  };
  const { nama, username, no_hp, email, password, brand, nama_toko } = body;

  if (!nama || !username || !no_hp || !email || !password || !brand || !nama_toko)
    return NextResponse.json({ error: "Nama, Username, No HP, Email, Password, Brand, and Nama Toko are required" }, { status: 400 });
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return NextResponse.json({ error: "Username can only contain letters, numbers, dots, dashes and underscores" }, { status: 400 });
  if (password.length < 6)
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });

  const db = admin();

  // Case-insensitive check before creating the auth user (the DB's unique
  // index on lower(username) is the real guarantee against a race — this is
  // just a friendlier error message for the common case).
  const { data: taken } = await db.from("profiles").select("id").ilike("username", username).maybeSingle();
  if (taken) return NextResponse.json({ error: "Username already taken" }, { status: 409 });

  const { data: authData, error: ae } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (ae || !authData.user)
    return NextResponse.json({ error: ae?.message ?? "Failed to create account" }, { status: 500 });

  const uid = authData.user.id;

  const { error: pe } = await db.rpc("provision_tenant", {
    p_user_id: uid,
    p_email: email,
    p_display_name: nama,
    p_username: username,
    p_phone: no_hp || null,
    p_brand: brand,
    p_nama_toko: nama_toko,
  });

  if (pe) {
    await db.auth.admin.deleteUser(uid); // rollback the auth user
    // The unique index surfaces as a Postgres error if the friendlier
    // pre-check above lost a race with another signup.
    const msg = pe.message.includes("profiles_username_unique_idx") ? "Username already taken" : pe.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
