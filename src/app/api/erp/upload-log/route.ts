import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// =====================================================================
// GET /api/erp/upload-log?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Read-only feed for the accounting ERP (accounting.profesoronline.id):
// per-day log of what each Owner uploaded on the "Upload Data" page
// (Ads Performance / Store Performance only — Order Complete and
// Finance Detail are out of scope here), plus the roster of Owners
// expected to upload, so the ERP can flag who didn't.
//
// Two defaults baked in below that weren't pinned down before building
// this (see the chat thread) — both easy to change if wrong:
//   1. Scoped to ONE tenant, ERP_CLIENT_ID (defaults to Prof Toko
//      Online's own client_id) — not every tenant this app hosts.
//   2. "admins" = active branch_manager (Owner) logins for that tenant,
//      each mapped to their own stores via store_links.owner ==
//      profiles.scope_owner. There's no client_admin-to-store
//      assignment table in this app, so client_admin staff are NOT
//      included here — if "admin" was meant to mean your staff instead
//      of Owners, this needs a different join once there's a real
//      staff/store assignment to read from.
//   "Deactivated" = profile row deleted (there's no is_active column on
//   profiles yet) — a deleted Owner's account simply won't appear.
// =====================================================================

const CLIENT_ID = process.env.ERP_CLIENT_ID || "92213048-a91b-4202-9b47-8d1c38671082"; // Prof Toko Online
const MAX_RANGE_DAYS = 60;
const JAKARTA_OFFSET = "+07:00"; // WIB, fixed — no DST to account for

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type UploadSource = "perf" | "spos" | "ads" | "ads_group";
const CATEGORY_OF: Record<UploadSource, "Store Performance" | "Ads Performance"> = {
  perf: "Store Performance", spos: "Store Performance",
  ads: "Ads Performance", ads_group: "Ads Performance",
};
const TAG_OF: Record<UploadSource, string> = {
  perf: "Store Performance", spos: "Product Performance", ads: "Ads Performance", ads_group: "Group",
};
const ADS_LEVEL_TAG: Record<string, string> = {
  incubation: "Inkubasi", hero: "Hero", low_conversion: "Low Conv.",
};

type UploadRow = {
  id: string; source: UploadSource; filename: string | null; created_at: string;
  meta: { pic_client?: string; brand?: string; store_name?: string; bulan?: string; year?: number; admin?: string; ads_level?: string } | null;
};

// SHA-256 comparison (not a raw string ===) so the check takes constant
// time regardless of where the first mismatched byte falls, AND so a
// length mismatch (the usual reason a naive timingSafeEqual throws or
// short-circuits) never leaks anything either — both sides are always
// fixed-length digests before comparing.
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.ERP_API_KEY;
  if (!expected) return false; // unset -> always 401, per spec
  const header = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!m) return false;
  return safeEqual(m[1], expected);
}

function jakartaDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00${JAKARTA_OFFSET}`);
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from and to are required, as YYYY-MM-DD" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const fromUTC = jakartaDayStart(from);
  const toUTCExclusive = new Date(jakartaDayStart(to).getTime() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(fromUTC.getTime()) || Number.isNaN(toUTCExclusive.getTime()) || fromUTC >= toUTCExclusive) {
    return NextResponse.json({ error: "invalid date range" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const rangeDays = Math.round((toUTCExclusive.getTime() - fromUTC.getTime()) / 86_400_000);
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `range too long — max ${MAX_RANGE_DAYS} days` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const db = createAdminClient();

  const [{ data: uploadRows, error: upErr }, { data: ownerRows, error: ownErr }, { data: linkRows, error: linkErr }] = await Promise.all([
    db.from("uploads")
      .select("id,source,filename,created_at,meta")
      .eq("client_id", CLIENT_ID)
      .in("source", ["perf", "spos", "ads", "ads_group"])
      .gte("created_at", fromUTC.toISOString())
      .lt("created_at", toUTCExclusive.toISOString())
      .order("created_at", { ascending: false }),
    db.from("profiles").select("display_name,scope_owner").eq("client_id", CLIENT_ID).eq("role", "branch_manager"),
    db.from("store_links").select("owner,store_name").eq("client_id", CLIENT_ID),
  ]);
  if (upErr || ownErr || linkErr) {
    return NextResponse.json({ error: "query failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const links = (linkRows as { owner: string | null; store_name: string | null }[]) || [];
  const admins = ((ownerRows as { display_name: string | null; scope_owner: string | null }[]) || [])
    .map((o) => ({
      name: o.display_name || o.scope_owner || "—",
      stores: Array.from(new Set(
        links.filter((l) => l.owner === o.scope_owner && l.store_name).map((l) => l.store_name as string)
      )).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Same grouping shape as the on-screen Upload Log (UploadLogTable.tsx):
  // one logical "upload" per category + store + period, regardless of how
  // many underlying `uploads` rows (files) made it up.
  type Group = {
    key: string; category: "Store Performance" | "Ads Performance";
    store: string; owner: string; month: string;
    latestAt: string; files: string[]; tags: string[];
    admin: string;
  };
  const groups = new Map<string, Group>();
  for (const u of (uploadRows as UploadRow[]) || []) {
    const category = CATEGORY_OF[u.source];
    const store = u.meta?.store_name || "";
    const owner = u.meta?.pic_client || "";
    const month = u.meta?.bulan || "";
    const key = [category, store, owner, month].join("|");
    let g = groups.get(key);
    if (!g) {
      g = { key, category, store, owner, month, latestAt: u.created_at, files: [], tags: [], admin: u.meta?.admin || "" };
      groups.set(key, g);
    }
    if (u.filename) g.files.push(u.filename);
    const tag = u.source === "ads_group"
      ? (ADS_LEVEL_TAG[u.meta?.ads_level || ""] || "Group")
      : TAG_OF[u.source];
    if (!g.tags.includes(tag)) g.tags.push(tag);
    if (new Date(u.created_at) > new Date(g.latestAt)) {
      g.latestAt = u.created_at;
      g.admin = u.meta?.admin || g.admin; // latest file's uploader wins if it differs
    }
  }

  const uploads = [...groups.values()]
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
    .map((g) => ({
      id: crypto.createHash("sha1").update(g.key).digest("hex"),
      uploadedAt: new Date(g.latestAt).toISOString(),
      type: g.category,
      admin: g.admin,
      owner: g.owner,
      store: g.store,
      month: g.month,
      week: "All", // grouping merges every week for the period into one log entry, same as the on-screen Upload Log
      files: g.files,
      tags: g.tags,
    }));

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), timezone: "Asia/Jakarta", admins, uploads },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
