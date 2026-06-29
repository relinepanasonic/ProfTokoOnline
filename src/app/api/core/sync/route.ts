import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Rebuilds master_data (owner, brand, store kinds) and store_links from
// existing uploads + sales_rows data. Safe to re-run — clears & rebuilds.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if ((profile as { role?: string } | null)?.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Load uploads → build upload_id → { clientId, owner (pic_client) } map
  const { data: uploads, error: uploadsErr } = await admin
    .from("uploads").select("id, client_id, meta");
  if (uploadsErr || !uploads) {
    return NextResponse.json({ error: "Failed to read uploads" }, { status: 500 });
  }
  const uploadMap = new Map<string, { clientId: string; owner: string | null }>();
  for (const u of uploads as { id: string; client_id: string; meta: Record<string, string> | null }[]) {
    uploadMap.set(u.id, { clientId: u.client_id, owner: u.meta?.pic_client || null });
  }

  // Load sales_rows → aggregate per (client_id, store_name) to find owner + dominant brand
  const { data: sales, error: salesErr } = await admin
    .from("sales_rows")
    .select("client_id, upload_id, store_name, brand")
    .not("store_name", "is", null);
  if (salesErr || !sales) {
    return NextResponse.json({ error: "Failed to read sales_rows" }, { status: 500 });
  }

  // Per (client_id, store_name): track owner + brand vote counts
  type Info = { clientId: string; storeName: string; owner: string | null; brandCounts: Record<string, number> };
  const storeInfo = new Map<string, Info>();

  for (const row of sales as { client_id: string; upload_id: string; store_name: string | null; brand: string | null }[]) {
    if (!row.store_name) continue;
    const key = `${row.client_id}|||${row.store_name}`;
    if (!storeInfo.has(key)) {
      const um = uploadMap.get(row.upload_id);
      storeInfo.set(key, { clientId: row.client_id, storeName: row.store_name, owner: um?.owner || null, brandCounts: {} });
    }
    const info = storeInfo.get(key)!;
    if (!info.owner) { const um = uploadMap.get(row.upload_id); if (um?.owner) info.owner = um.owner; }
    if (row.brand && row.brand !== "Others") {
      info.brandCounts[row.brand] = (info.brandCounts[row.brand] || 0) + 1;
    }
  }

  // Resolve dominant brand per store
  type StoreEntry = { clientId: string; storeName: string; owner: string | null; brand: string | null };
  const resolved: StoreEntry[] = [];
  for (const info of storeInfo.values()) {
    const brand = Object.keys(info.brandCounts).length > 0
      ? Object.entries(info.brandCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null;
    resolved.push({ clientId: info.clientId, storeName: info.storeName, owner: info.owner, brand });
  }

  const affectedClients = Array.from(new Set(resolved.map((r) => r.clientId)));

  // ── rebuild store_links ──────────────────────────────────────────────────
  // Three kinds of rows:
  //   1. store rows:  (owner, brand, store_name) — one per store
  //   2. brand rows:  (owner, brand, null)        — one per unique owner+brand pair
  // This lets the Core List show the owner→brand tree even before stores are added.

  const brandSet = new Map<string, Set<string>>(); // clientId → set of "owner|||brand"
  const storeLinks: { client_id: string; owner: string | null; brand: string | null; store_name: string | null }[] = [];
  const masterRows: { client_id: string; kind: string; value: string }[] = [];

  for (const entry of resolved) {
    // store_links: store row
    storeLinks.push({ client_id: entry.clientId, owner: entry.owner, brand: entry.brand, store_name: entry.storeName });

    // master_data: owner, brand, store
    if (entry.owner) masterRows.push({ client_id: entry.clientId, kind: "owner", value: entry.owner });
    if (entry.brand) masterRows.push({ client_id: entry.clientId, kind: "brand", value: entry.brand });
    masterRows.push({ client_id: entry.clientId, kind: "store", value: entry.storeName });

    // Track unique owner+brand combos for brand-level store_links rows
    if (entry.owner && entry.brand) {
      const ck = entry.clientId;
      if (!brandSet.has(ck)) brandSet.set(ck, new Set());
      brandSet.get(ck)!.add(`${entry.owner}|||${entry.brand}`);
    }
  }

  // brand-level store_links rows (owner→brand, no store)
  for (const [clientId, combos] of brandSet) {
    for (const combo of combos) {
      const [owner, brand] = combo.split("|||");
      storeLinks.push({ client_id: clientId, owner, brand, store_name: null });
    }
  }

  // Delete existing data for affected clients and reinsert
  for (const clientId of affectedClients) {
    await admin.from("store_links").delete().eq("client_id", clientId);
    // Remove owner/brand/store kinds (keep city and platform — those are user-managed)
    await admin.from("master_data").delete().eq("client_id", clientId).in("kind", ["owner", "brand", "store"]);
  }

  if (storeLinks.length > 0) {
    const { error: slErr } = await admin.from("store_links").insert(storeLinks);
    if (slErr) return NextResponse.json({ error: "store_links insert: " + slErr.message }, { status: 500 });
  }

  // Deduplicate master_data rows before inserting
  const mdUniq = new Map<string, { client_id: string; kind: string; value: string }>();
  for (const row of masterRows) {
    const key = `${row.client_id}|||${row.kind}|||${row.value}`;
    if (!mdUniq.has(key)) mdUniq.set(key, row);
  }
  if (mdUniq.size > 0) {
    const { error: mdErr } = await admin.from("master_data").upsert(
      Array.from(mdUniq.values()),
      { onConflict: "client_id,kind,value", ignoreDuplicates: true }
    );
    if (mdErr) return NextResponse.json({ error: "master_data upsert: " + mdErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stores: resolved.length, clients: affectedClients.length });
}
