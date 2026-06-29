import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Rebuilds master_data (owner, brand, store kinds) and store_links from
// existing uploads metadata (NOT from auto-detected sales_rows.brand).
// Business brand = uploads.meta.brand, owner = uploads.meta.pic_client,
// store = uploads.meta.store_name. Safe to re-run — clears & rebuilds.
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

  // Load all uploads — the meta.brand is the business brand the user selected,
  // meta.pic_client is the owner, meta.store_name is the store.
  const { data: uploads, error: uploadsErr } = await admin
    .from("uploads").select("id, client_id, meta");
  if (uploadsErr || !uploads) {
    return NextResponse.json({ error: "Failed to read uploads" }, { status: 500 });
  }

  type UploadMeta = { pic_client?: string; store_name?: string; brand?: string };

  // Aggregate per (client_id, store_name): unique owner + business brand from meta
  type StoreKey = string; // `${clientId}|||${storeName}`
  const storeInfo = new Map<StoreKey, { clientId: string; storeName: string; owner: string | null; brand: string | null }>();

  for (const u of uploads as { id: string; client_id: string; meta: UploadMeta | null }[]) {
    const meta = u.meta || {};
    const storeName = meta.store_name;
    if (!storeName) continue;
    const key: StoreKey = `${u.client_id}|||${storeName}`;
    if (!storeInfo.has(key)) {
      storeInfo.set(key, {
        clientId: u.client_id,
        storeName,
        owner: meta.pic_client || null,
        brand: meta.brand || null,
      });
    } else {
      const info = storeInfo.get(key)!;
      if (!info.owner && meta.pic_client) info.owner = meta.pic_client;
      if (!info.brand && meta.brand) info.brand = meta.brand;
    }
  }

  const resolved = Array.from(storeInfo.values());
  const affectedClients = Array.from(new Set(resolved.map((r) => r.clientId)));

  // ── rebuild store_links & master_data ──────────────────────────────────
  const storeLinks: { client_id: string; owner: string | null; brand: string | null; store_name: string | null }[] = [];
  const masterRows: { client_id: string; kind: string; value: string }[] = [];
  const brandPairs = new Map<string, Set<string>>(); // clientId → "owner|||brand"

  for (const entry of resolved) {
    // store-level store_links row
    storeLinks.push({ client_id: entry.clientId, owner: entry.owner, brand: entry.brand, store_name: entry.storeName });

    // master_data rows
    if (entry.owner) masterRows.push({ client_id: entry.clientId, kind: "owner", value: entry.owner });
    if (entry.brand) masterRows.push({ client_id: entry.clientId, kind: "brand", value: entry.brand });
    masterRows.push({ client_id: entry.clientId, kind: "store", value: entry.storeName });

    // Track unique owner+brand for brand-level store_links
    if (entry.owner && entry.brand) {
      if (!brandPairs.has(entry.clientId)) brandPairs.set(entry.clientId, new Set());
      brandPairs.get(entry.clientId)!.add(`${entry.owner}|||${entry.brand}`);
    }
  }

  // Brand-level store_links (owner → brand, no store yet)
  for (const [clientId, combos] of brandPairs) {
    for (const combo of combos) {
      const [owner, brand] = combo.split("|||");
      storeLinks.push({ client_id: clientId, owner, brand, store_name: null });
    }
  }

  // Delete old data and reinsert
  for (const clientId of affectedClients) {
    await admin.from("store_links").delete().eq("client_id", clientId);
    await admin.from("master_data").delete().eq("client_id", clientId).in("kind", ["owner", "brand", "store"]);
  }
  if (storeLinks.length > 0) {
    const { error: slErr } = await admin.from("store_links").insert(storeLinks);
    if (slErr) return NextResponse.json({ error: "store_links: " + slErr.message }, { status: 500 });
  }

  // Deduplicate + upsert master_data rows
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
    if (mdErr) return NextResponse.json({ error: "master_data: " + mdErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stores: resolved.length, clients: affectedClients.length });
}
