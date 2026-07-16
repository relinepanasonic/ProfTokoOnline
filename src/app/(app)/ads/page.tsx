"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import UploadGate from "@/components/UploadGate";
import UploadIklan from "./UploadIklan";

// recharts (~430KB) lives only in AdsOverview — loaded client-side on demand,
// same convention as the main Dashboard's DashboardCharts.tsx split.
const AdsOverview = dynamicImport(() => import("./AdsOverview"), { ssr: false, loading: () => <Loader center /> });

export const dynamic = "force-dynamic";

// The Grup Iklan Performance table, Formulation tab, and everything that
// only existed to support them (drill-down, threshold editor, workflow
// diagram, Analisa switch rules) were removed per request — this page is
// now just the upload widget + the Ads Performance overview.
export default function AdsPerformancePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [role, setRole] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      setRole((p as { role: string } | null)?.role || "");
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
    })();
  }, [supabase]);

  const canUpload = ["superadmin", "client_admin", "advertiser"].includes(role);

  return (
    <UploadGate>
      {canUpload && (
        <UploadIklan clientId={clientId} supabase={supabase} onUploaded={() => setRefreshKey((k) => k + 1)} />
      )}
      {clientId && <AdsOverview clientId={clientId} refreshKey={refreshKey} />}
    </UploadGate>
  );
}
