"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StoreDashboard from "./StoreDashboard";
import StoreUpload from "./StoreUpload";

export const dynamic = "force-dynamic";

const TABS = [
  { v: "dashboard", l: "Operational Performance" },
  { v: "upload", l: "Upload Operational Performance" },
] as const;

export default function Page() {
  const [supabase] = useState(() => createClient());
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: cs } = await supabase.from("clients").select("id").order("created_at").limit(1);
      setClientId((cs as { id: string }[])?.[0]?.id || "");
    })();
  }, [supabase]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)} style={tabBtn(tab === t.v)}>{t.l}</button>
        ))}
      </div>
      {tab === "dashboard" && <StoreDashboard clientId={clientId} refreshKey={refreshKey} />}
      {tab === "upload" && <StoreUpload clientId={clientId} onUploaded={() => setRefreshKey((k) => k + 1)} />}
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
