"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";

export const dynamic = "force-dynamic";

// StoreDashboard pulls in recharts + the d3-geo/topojson Indonesia map;
// loaded client-side on demand instead of bundled into every /store load.
const StoreDashboard = dynamicImport(() => import("./StoreDashboard"), { ssr: false, loading: () => <Loader center /> });
const StoreUpload = dynamicImport(() => import("./StoreUpload"), { ssr: false });

const TABS = [
  { v: "dashboard", l: "Operational Performance" },
  { v: "upload", l: "Upload Operational Performance" },
] as const;
// Upload is an admin tool; Owners see the read dashboard only.
const MANAGE_ROLES = ["superadmin", "client_admin"];

export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: cs }, { data: p }] = await Promise.all([
        supabase.from("clients").select("id").order("created_at").limit(1),
        user ? supabase.from("profiles").select("role").eq("id", user.id).single() : Promise.resolve({ data: null }),
      ]);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
      setCanManage(MANAGE_ROLES.includes((p as { role?: string } | null)?.role || ""));
    })();
  }, [supabase]);

  return (
    <>
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button key={t.v} onClick={() => setTab(t.v)} style={tabBtn(tab === t.v)}>{t.l}</button>
          ))}
        </div>
      )}
      {tab === "dashboard" && <StoreDashboard clientId={clientId} refreshKey={refreshKey} />}
      {canManage && tab === "upload" && <StoreUpload clientId={clientId} onUploaded={() => setRefreshKey((k) => k + 1)} />}
    </>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: "9px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${active ? "var(--gold)" : "rgba(201,162,39,.2)"}`,
    background: active ? "linear-gradient(135deg,var(--gold),var(--gold-soft))" : "rgba(10,22,40,.5)",
    color: active ? "var(--navy-deep)" : "#cdd9f0",
  };
}
