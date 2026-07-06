"use client";

import { useState } from "react";
import ProoneReports from "./ProoneReports";
import AccountingInvoice from "./AccountingInvoice";
import AccountingReport from "./AccountingReport";

export const dynamic = "force-dynamic";

const TABS = [
  { v: "dashboard", l: "Dashboard" },
  { v: "invoice", l: "Invoice" },
  { v: "report", l: "Report" },
] as const;

export default function Page() {
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>("dashboard");
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)} style={tabBtn(tab === t.v)}>{t.l}</button>
        ))}
      </div>
      {tab === "dashboard" && <ProoneReports />}
      {tab === "invoice" && <AccountingInvoice />}
      {tab === "report" && <AccountingReport />}
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
