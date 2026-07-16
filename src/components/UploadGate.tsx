"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";

// Wraps a page's content and blurs it behind an "Upload the Data First" CTA
// until at least one row exists in dashboard_rollup for the caller's scope
// (RLS already restricts the read to their own client/store scope, so this
// single lightweight check works identically for every role/plan).
export default function UploadGate({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const [supabase] = useState(() => createClient());
  const [hasData, setHasData] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("dashboard_rollup").select("client_id").limit(1);
      setHasData(!!data && data.length > 0);
    })();
  }, [supabase]);

  // Blur by default (hasData starts null while the check is in flight) —
  // only lift it once we've positively confirmed data exists. Showing the
  // real content first and blurring a few seconds later (the old
  // `hasData === false` check) produced a visible unblurred flash on every
  // navigation while the query resolved.
  if (hasData !== true) {
    return (
      <div style={{ position: "relative" }}>
        <div style={{ filter: "blur(6px)", pointerEvents: "none", userSelect: "none" }} aria-hidden>
          {children}
        </div>
        <div style={{
          position: "absolute", inset: 0,
          background: "rgba(6,12,24,.6)", borderRadius: 16, zIndex: 5,
        }}>
          {/* sticky, not centered in the full (possibly very tall) blurred
              content — pins near the top of the viewport as the page
              scrolls, so it's visible immediately with no scrolling. */}
          <div style={{ position: "sticky", top: 90, display: "flex", justifyContent: "center", padding: "40px 20px" }}>
            <div style={{ textAlign: "center", padding: 28, maxWidth: 340 }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>⬆️</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 16, lineHeight: 1.4 }}>
                {t("Upload the Data First in Upload Page to open the Features")}
              </div>
              <Link href="/upload" className="btn-gold" style={{ display: "inline-block", padding: "10px 26px", borderRadius: 10, textDecoration: "none", fontWeight: 700 }}>
                {t("Go to Upload Page")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
