import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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

  // Load all uploads (owner = meta.pic_client)
  const { data: uploads, error: uploadsErr } = await admin
    .from("uploads")
    .select("id, client_id, meta");
  if (uploadsErr || !uploads) {
    return NextResponse.json({ error: "Failed to read uploads" }, { status: 500 });
  }

  // Build upload_id → { clientId, owner } map
  const uploadMap = new Map<string, { clientId: string; owner: string | null }>();
  for (const u of uploads as { id: string; client_id: string; meta: Record<string, string> | null }[]) {
    uploadMap.set(u.id, {
      clientId: u.client_id,
      owner: u.meta?.pic_client || null,
    });
  }

  // Load sales_rows to find dominant brand per store
  const { data: sales, error: salesErr } = await admin
    .from("sales_rows")
    .select("client_id, upload_id, store_name, brand")
    .not("store_name", "is", null);
  if (salesErr || !sales) {
    return NextResponse.json({ error: "Failed to read sales_rows" }, { status: 500 });
  }

  // Aggregate: per (client_id, store_name) → owner + dominant brand
  const storeInfo = new Map<string, { clientId: string; storeName: string; owner: string | null; brandCounts: Record<string, number> }>();

  for (const row of sales as { client_id: string; upload_id: string; store_name: string | null; brand: string | null }[]) {
    if (!row.store_name) continue;
    const key = `${row.client_id}|||${row.store_name}`;
    if (!storeInfo.has(key)) {
      const um = uploadMap.get(row.upload_id);
      storeInfo.set(key, {
        clientId: row.client_id,
        storeName: row.store_name,
        owner: um?.owner || null,
        brandCounts: {},
      });
    }
    const info = storeInfo.get(key)!;
    if (!info.owner) {
      const um = uploadMap.get(row.upload_id);
      if (um?.owner) info.owner = um.owner;
    }
    if (row.brand && row.brand !== "Others") {
      info.brandCounts[row.brand] = (info.brandCounts[row.brand] || 0) + 1;
    }
  }

  // Build store_links rows (pick dominant brand per store)
  const linksToInsert = Array.from(storeInfo.values()).map((info) => {
    const brand = Object.keys(info.brandCounts).length > 0
      ? Object.entries(info.brandCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null;
    return { client_id: info.clientId, owner: info.owner, brand, store_name: info.storeName };
  });

  const affectedClients = Array.from(new Set(linksToInsert.map((l) => l.client_id)));

  // Replace store_links for affected clients
  for (const clientId of affectedClients) {
    await admin.from("store_links").delete().eq("client_id", clientId);
  }
  if (linksToInsert.length > 0) {
    const { error: insertErr } = await admin.from("store_links").insert(linksToInsert);
    if (insertErr) {
      return NextResponse.json({ error: "Insert failed: " + insertErr.message }, { status: 500 });
    }
  }

  // Also upsert unique brands into master_data per client
  const brandsByClient = new Map<string, Set<string>>();
  for (const l of linksToInsert) {
    if (!l.brand) continue;
    if (!brandsByClient.has(l.client_id)) brandsByClient.set(l.client_id, new Set());
    brandsByClient.get(l.client_id)!.add(l.brand);
  }
  for (const [clientId, brands] of brandsByClient) {
    for (const brand of brands) {
      await admin.from("master_data").upsert(
        { client_id: clientId, kind: "brand", value: brand },
        { onConflict: "client_id,kind,value", ignoreDuplicates: true }
      );
    }
  }

  return NextResponse.json({ ok: true, stores: linksToInsert.length, clients: affectedClients.length });
}
