"use client";

import Link from "next/link";
import Placeholder from "@/components/Placeholder";

export default function Page() {
  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>
      {/* Same tab strip as /calc/marketplace-fee, mirrored — Massive
          Calculator itself is still a placeholder, but the Marketplace
          Fee tab (built) needs to be reachable from here too. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <span className="mode-tab on">Massive Calculator</span>
        <Link href="/calc/marketplace-fee" className="mode-tab">Marketplace Fee</Link>
      </div>
      <Placeholder icon="🧮" title="Price Calculator" desc="Excel-like editable grid with paste, fill-handle and live profit calculation — coming in the next build stage." />
    </>
  );
}
