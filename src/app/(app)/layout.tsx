"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/i18n";

type Role = "superadmin" | "client_admin" | "branch_manager" | "store_user" | "advertiser";

// 4-tier permission model:
//   superadmin      — everything
//   client_admin    — Upload, Core List, Market Place Fee (see/edit/delete)
//   advertiser      — Dashboard, Ads Performance (see/edit/delete)
//   branch_manager  — Dashboard, Ads Performance, Price Calculator,
//                     Market Place Fee (read-only, scoped to their Owner)
const NAV: { href: string; icon: string; label: string; roles?: Role[] }[] = [
  { href: "/",          icon: "📊", label: "Dashboard",           roles: ["superadmin", "branch_manager", "advertiser"] },
  { href: "/ads",       icon: "🎯", label: "Ads Performance",     roles: ["superadmin", "branch_manager", "advertiser"] },
  { href: "/product",   icon: "💹", label: "Detail Keuangan",     roles: ["superadmin"] },
  { href: "/store",     icon: "🏬", label: "Operational Performance", roles: ["superadmin"] },
  { href: "/calc",      icon: "🧮", label: "Price Calculator",    roles: ["superadmin", "branch_manager"] },
  { href: "/marketfee", icon: "💰", label: "Market Place Fee",    roles: ["superadmin", "branch_manager", "client_admin"] },
  { href: "/upload",    icon: "⬆️", label: "Upload Data",         roles: ["superadmin", "client_admin"] },
  { href: "/core",      icon: "🗂️", label: "Core List",          roles: ["superadmin", "client_admin"] },
  { href: "/accounting", icon: "📒", label: "Accounting",         roles: ["superadmin"] },
  { href: "/users",     icon: "👥", label: "Users",               roles: ["superadmin"] },
  { href: "/invoice",   icon: "🧾", label: "Invoice",             roles: ["superadmin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  client_admin: "Client Admin",
  branch_manager: "Owner",
  store_user: "Store",
  advertiser: "Advertiser",
};

// ── Owner subscription tiers ────────────────────────────────────────────────
// Tiers only gate the Owner (branch_manager) role. Basic = Juragan; the rest
// are Premium. 'signup' = registered but not activated yet (pending screen).
type Tier = "signup" | "juragan" | "sultan" | "king" | "free_trial";
const TIER_LABEL: Record<Tier, string> = {
  signup: "Pending", juragan: "Juragan", sultan: "Sultan", king: "King", free_trial: "Free Trial",
};
const PREMIUM_TIERS: Tier[] = ["sultan", "king", "free_trial"];
// Which pages each owner tier may see.
const OWNER_BASIC_PAGES   = ["/", "/upload", "/marketfee"];
const OWNER_PREMIUM_PAGES = ["/", "/ads", "/product", "/store", "/calc", "/upload", "/marketfee"];

function ownerPages(tier: Tier): string[] {
  return PREMIUM_TIERS.includes(tier) ? OWNER_PREMIUM_PAGES : OWNER_BASIC_PAGES;
}

function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle">
      <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
      <button className={lang === "id" ? "active" : ""} onClick={() => setLang("id")}>ID</button>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [supabase] = useState(() => createClient());
  const { t } = useLang();
  const [role, setRole] = useState<Role>();
  const [name, setName] = useState("—");
  const [clientName, setClientName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tier, setTier] = useState<Tier>();
  const [subExpires, setSubExpires] = useState<string | null>(null);
  // Captured after mount so render stays pure (no Date.now() during render).
  const [now, setNow] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMenuOpen(false); }, [path]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase
        .from("profiles").select("role, display_name, client_id, tier, sub_expires_at").eq("id", user.id).single();
      if (p) {
        setRole(p.role as Role);
        setTier((p.tier as Tier) ?? "signup");
        setSubExpires(p.sub_expires_at ?? null);
        setName(p.display_name || user.email?.split("@")[0] || "User");
        if (p.client_id) {
          const { data: c } = await supabase.from("clients").select("name").eq("id", p.client_id).single();
          if (c?.name) setClientName(c.name);
        }
      }
    })();
  }, [supabase]);

  // Owner subscription state (only meaningful for branch_manager).
  const isOwner  = role === "branch_manager";
  const isSignup = isOwner && tier === "signup";
  const isExpired = isOwner && !!subExpires && now != null && new Date(subExpires).getTime() <= now;
  const ownerAllowed = useMemo(() => (isOwner && tier ? ownerPages(tier) : []), [isOwner, tier]);
  const daysLeft = subExpires && now != null
    ? Math.ceil((new Date(subExpires).getTime() - now) / 86_400_000)
    : null;

  // Which pages this login may see. Owners are driven by their tier's page
  // set (which intentionally differs from the base NAV.roles); everyone else
  // by the role list.
  const canSee = (href: string): boolean => {
    if (isOwner) return ownerAllowed.includes(href);
    const entry = NAV.find((n) => n.href === href);
    return !entry?.roles || (!!role && entry.roles.includes(role));
  };

  // Route guard: bounce away from any page this login can't see. A pending
  // (signup) owner is held on the pending screen regardless of path.
  useEffect(() => {
    if (!role) return;
    if (isSignup) return; // pending screen replaces content; no redirect needed
    const entry = NAV.find((n) => n.href === path);
    const allowed = isOwner ? ownerAllowed.includes(path) : (!entry?.roles || entry.roles.includes(role));
    if (!allowed) {
      const fallback = isOwner ? (ownerAllowed[0] || "/") : (NAV.find((n) => !n.roles || n.roles.includes(role))?.href || "/login");
      router.replace(fallback);
    }
  }, [role, path, router, isOwner, isSignup, ownerAllowed]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const visible = NAV.filter((n) => canSee(n.href));
  const current = NAV.find((n) => n.href === path);

  return (
    <div className="app">
      {/* Sidebar (desktop) */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="logo" style={{ width: 42, height: 42, objectFit: "contain", borderRadius: 8 }} />
          </div>
          <div>
            <div className="t1">Prof Toko Online</div>
            <div className="t2">{clientName}</div>
          </div>
        </div>
        <ul className="nav-list">
          {visible.map((n) => (
            <li key={n.href} className={path === n.href ? "active" : ""}>
              <Link href={n.href} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", color: "inherit", textDecoration: "none" }}>
                <span className="ic">{n.icon}</span> {t(n.label)}
              </Link>
            </li>
          ))}
        </ul>
        <div className="foot">v1.0 · Supabase</div>
      </aside>

      {/* Main */}
      <main className="main">
        {/* Mobile header */}
        <div className="mob-header">
          <div className="mob-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="logo" style={{ width: 36, height: 36, objectFit: "contain" }} />
            <div>
              <div className="mob-title">Prof Toko Online</div>
              <div className="mob-sub">{clientName}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isOwner && tier && !isSignup && <SubPill tier={tier} daysLeft={daysLeft} expired={isExpired} t={t} compact />}
            <LangToggle />
            <button className="btn-logout" onClick={logout}>{t("Logout")}</button>
          </div>
        </div>

        {/* Desktop topbar */}
        <div className="topbar">
          <div>
            <div className="page-title">{t(current?.label || "Dashboard")}</div>
            <div className="page-sub">{t("Marketplace performance overview — Shopee")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <LangToggle />
            {isOwner && tier && !isSignup && <SubPill tier={tier} daysLeft={daysLeft} expired={isExpired} t={t} />}
            <div className="user-badge">
              <span>{name}</span>
              {role && <span className="user-role">{isOwner && tier && tier !== "signup" ? TIER_LABEL[tier] : ROLE_LABEL[role]}</span>}
            </div>
            <button className="btn-logout" onClick={logout}>{t("Logout")}</button>
          </div>
        </div>

        {isSignup
          ? <PendingScreen t={t} />
          : <>
              {isExpired && (
                <div className="sub-expired-banner">
                  ⏳ {t("Your subscription has ended — read-only mode. Contact us to renew.")}
                </div>
              )}
              {children}
            </>}
      </main>

      {/* Mobile bottom nav: single hamburger opening the full sidebar-order menu */}
      <nav className="bottom-nav">
        <button className="bn-hamburger" onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <span /><span /><span />
        </button>
        <span className="bn-current">
          <span style={{ fontSize: 18 }}>{current?.icon}</span>
          {t(current?.label || "Dashboard")}
        </span>
      </nav>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <>
          <div className="mobile-drawer-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="mobile-drawer">
            <div className="mobile-drawer-head">
              <div className="brand">
                <div className="logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="logo" style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8 }} />
                </div>
                <div>
                  <div className="t1">Prof Toko Online</div>
                  <div className="t2">{clientName}</div>
                </div>
              </div>
              <button className="mobile-drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">✕</button>
            </div>
            <ul className="nav-list">
              {visible.map((n) => (
                <li key={n.href} className={path === n.href ? "active" : ""}>
                  <Link href={n.href} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", color: "inherit", textDecoration: "none" }}>
                    <span className="ic">{n.icon}</span> {t(n.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// Countdown / tier pill shown to Owners. Green while active, amber when
// under a week, red once expired.
function SubPill({ tier, daysLeft, expired, t, compact }: {
  tier: Tier; daysLeft: number | null; expired: boolean; t: (k: string) => string; compact?: boolean;
}) {
  const color = expired ? "#f87171" : daysLeft != null && daysLeft <= 7 ? "#fbbf24" : "#34d399";
  const label = expired
    ? t("Expired")
    : daysLeft == null
    ? t("Unlimited")
    : `${daysLeft} ${t("days left")}`;
  return (
    <span title={TIER_LABEL[tier]} style={{
      display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      padding: compact ? "3px 8px" : "5px 11px", borderRadius: 999,
      fontSize: compact ? 10.5 : 12, fontWeight: 700,
      background: `${color}1a`, color, border: `1px solid ${color}44`,
    }}>
      {!compact && <span style={{ opacity: .85 }}>{TIER_LABEL[tier]} ·</span>} {label}
    </span>
  );
}

// Holding screen for a freshly-signed-up Owner whose tier hasn't been
// activated by a Superadmin yet.
function PendingScreen({ t }: { t: (k: string) => string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: 24 }}>
      <div className="panel" style={{ maxWidth: 460, textAlign: "center", padding: "40px 32px" }}>
        <div style={{ fontSize: 46, marginBottom: 14 }}>⏳</div>
        <h2 style={{ margin: "0 0 10px", color: "#fff" }}>{t("Account pending activation")}</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
          {t("Your account is registered. Our team will activate your plan shortly — you'll get full access once it's switched on.")}
        </p>
      </div>
    </div>
  );
}
