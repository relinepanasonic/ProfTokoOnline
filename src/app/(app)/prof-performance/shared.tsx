"use client";

// Shared by the 3 Prof Performance sub-pages (Project / Advertising / Admin).
// Internal-only (superadmin/client_admin/advertiser) — no Owner/Store login
// sees this section. layout.tsx's generic NAV route-guard only matches a
// path EXACT-equal to a NAV href, so a nested route like
// /prof-performance/admin falls through it unguarded (the same gap
// /calc/marketplace-fee already relies on for its own, deliberately looser,
// read-only-for-Owners access). Here that gap would let ANY logged-in role
// reach these pages, so each page re-checks role itself via useStaffOnly()
// rather than trusting the shell.
//
// Per-page role sets differ: Project/Admin are superadmin+client_admin;
// Advertising is superadmin+advertiser (client_admin does NOT get this one —
// narrower than the section's own sidebar entry, which stays visible to all
// three so client_admin can still reach Project/Admin).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Stable module-level defaults — passing an inline array literal as the
// argument would give useEffect below a new reference every render and
// loop forever, so callers that need a non-default set should also define
// their own array at module scope (see advertising/page.tsx).
// Section-wide default: Superadmin, Admin, Advertiser. Advertising itself
// narrows this further (Superadmin + Advertiser only, no Admin).
const DEFAULT_ROLES = ["superadmin", "client_admin", "advertiser"] as const;

export function useStaffOnly(allowedRoles: readonly string[] = DEFAULT_ROLES) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace("/login"); return; }
      const { data: p } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      const role = (p as { role?: string } | null)?.role;
      if (!role || !allowedRoles.includes(role)) { router.replace("/"); return; }
      setReady(true);
    })();
  }, [router, allowedRoles]);
  return ready;
}

const TABS = [
  { href: "/prof-performance",             label: "Project" },
  { href: "/prof-performance/advertising", label: "Advertising" },
  { href: "/prof-performance/admin",       label: "Admin" },
] as const;

export function ProfPerfTabs({ active }: { active: string }) {
  return (
    <>
      <style>{`
        .mode-tab{padding:7px 16px;border-radius:9px;border:1px solid var(--card-border);background:var(--glass);
          color:var(--text-2);font-weight:700;font-size:13px;cursor:pointer;text-decoration:none;display:inline-block}
        .mode-tab.on{background:linear-gradient(135deg,var(--gold),var(--gold-soft));color:var(--navy-deep);border-color:transparent}
      `}</style>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {TABS.map((t) => t.href === active
          ? <span key={t.href} className="mode-tab on">{t.label}</span>
          : <Link key={t.href} href={t.href} className="mode-tab">{t.label}</Link>
        )}
      </div>
    </>
  );
}
