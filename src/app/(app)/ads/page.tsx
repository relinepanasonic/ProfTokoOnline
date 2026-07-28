"use client";

import { useEffect, useState } from "react";
import dynamicImport from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import Loader from "@/components/Loader";
import UploadGate from "@/components/UploadGate";

// recharts (~430KB) lives only in AdsOverview — loaded client-side on demand,
// same convention as the main Dashboard's DashboardCharts.tsx split.
const AdsOverview = dynamicImport(() => import("./AdsOverview"), { ssr: false, loading: () => <Loader center /> });

export const dynamic = "force-dynamic";

// The Grup Iklan Performance table, Formulation tab, and everything that
// only existed to support them (drill-down, threshold editor, workflow
// diagram, Analisa switch rules) were removed per request — this page is
// now just the Ads Performance overview. The Upload Iklan widget (still
// used by the Upload page's GMV Auto/Group Ads cards via UploadIklan.tsx)
// was also pulled from here — all uploads now live on the Upload page only.
export default function AdsPerformancePage() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
    })();
  }, [supabase]);

  return (
    <UploadGate>
      {clientId && <AdsOverview clientId={clientId} />}
    </UploadGate>
  );
}
