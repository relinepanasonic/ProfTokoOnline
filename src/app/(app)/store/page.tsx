"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import UploadGate from "@/components/UploadGate";

export const dynamic = "force-dynamic";

// StoreDashboard pulls in recharts + the d3-geo/topojson Indonesia map;
// loaded client-side on demand instead of bundled into every /store load.
const StoreDashboard = dynamicImport(() => import("./StoreDashboard"), { ssr: false, loading: () => <Loader center /> });

// Ops upload now lives on the consolidated /upload page (Ops Performa card)
// — this page is read-only dashboard only.
export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [refreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
    })();
  }, [supabase]);

  return (
    <UploadGate>
      <StoreDashboard clientId={clientId} refreshKey={refreshKey} />
    </UploadGate>
  );
}
