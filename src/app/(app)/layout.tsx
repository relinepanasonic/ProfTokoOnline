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
  { href: "/upload",    icon: "⬆️", label: "Upload Data",         roles: ["superadmin", "client_admin", "advertiser"] },
  { href: "/",          icon: "📊", label: "Dashboard",           roles: ["superadmin", "branch_manager", "advertiser"] },
  { href: "/ads",       icon: "🎯", label: "Ads Performance",     roles: ["superadmin", "branch_manager", "advertiser"] },
  { href: "/product",   icon: "💹", label: "Finance Detail",      roles: ["superadmin"] },
  { href: "/store",     icon: "🏬", label: "Operational Performance", roles: ["superadmin"] },
  { href: "/calc",      icon: "🧮", label: "Price Calculator",    roles: ["superadmin", "branch_manager"] },
  { href: "/marketfee", icon: "💰", label: "Market Place Fee",    roles: ["superadmin", "branch_manager", "client_admin"] },
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

// ── Owner subscription plans ────────────────────────────────────────────────
// Plans only gate the Owner (branch_manager) role. Self-registered owners
// (/register, true multi-tenant — their own clients row) get a 30-day Sultan
// free trial at signup; a Superadmin can change the plan anytime on the
// Users page. Core List (brand/store management) is a superadmin/client_admin
// tool only — no owner plan sees it; Upload is first in both lists so it's
// the landing page owners hit first.
// "prof" — agency-managed real clients (our team uploads the 5 core Shopee
// files for them; see UploadHere.tsx's isProf lock). Its label ("Prof")
// doubles as the Owner-role display name for these logins, since the topbar
// shows PLAN_LABEL[plan] in place of ROLE_LABEL[role] for any Owner login
// (see the user-badge JSX below) — no separate role/label wiring needed.
type Plan = "lapak" | "sultan" | "king" | "prof";
const PLAN_LABEL: Record<Plan, string> = { lapak: "Juragan", sultan: "Sultan", king: "King", prof: "Prof" };
const PREMIUM_PLANS: Plan[] = ["sultan", "king", "prof"];
// Which pages each owner plan may see.
const LAPAK_PAGES  = ["/upload", "/", "/marketfee"];
const FULL_PAGES    = ["/upload", "/", "/ads", "/product", "/store", "/calc", "/marketfee"];

function ownerPages(plan: Plan): string[] {
  return PREMIUM_PLANS.includes(plan) ? FULL_PAGES : LAPAK_PAGES;
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
  const [plan, setPlan] = useState<Plan>();
  const [subEnd, setSubEnd] = useState<string | null>(null);
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
        .from("profiles").select("role, display_name, client_id, plan_type, subscription_end").eq("id", user.id).single();
      if (p) {
        setRole(p.role as Role);
        setPlan((p.plan_type as Plan) ?? undefined);
        setSubEnd(p.subscription_end ?? null);
        setName(p.display_name || user.email?.split("@")[0] || "User");
        if (p.client_id) {
          const { data: c } = await supabase.from("clients").select("name").eq("id", p.client_id).single();
          if (c?.name) setClientName(c.name);
        }
      }
    })();
  }, [supabase]);

  // Owner subscription state (only meaningful for branch_manager). A missing
  // plan_type falls back to Lapak for page access so a data glitch never fully
  // locks an owner out; the time gate is handled separately by isExpired.
  const isOwner  = role === "branch_manager";
  const effectivePlan: Plan = plan ?? "lapak";
  const isExpired = isOwner && !!subEnd && now != null && new Date(subEnd).getTime() <= now;
  const ownerAllowed = useMemo(() => (isOwner ? ownerPages(effectivePlan) : []), [isOwner, effectivePlan]);
  const daysLeft = subEnd && now != null
    ? Math.ceil((new Date(subEnd).getTime() - now) / 86_400_000)
    : null;

  // Which pages this login may see. Owners are driven by their plan's page
  // set (which intentionally differs from the base NAV.roles); everyone else
  // by the role list.
  const canSee = (href: string): boolean => {
    if (isOwner) return ownerAllowed.includes(href);
    const entry = NAV.find((n) => n.href === href);
    return !entry?.roles || (!!role && entry.roles.includes(role));
  };

  // Route guard: bounce away from any page this login can't see (blocked
  // Lapak pages, or pages the role isn't allowed).
  useEffect(() => {
    if (!role) return;
    const entry = NAV.find((n) => n.href === path);
    const allowed = isOwner ? ownerAllowed.includes(path) : (!entry?.roles || entry.roles.includes(role));
    if (!allowed) {
      const fallback = isOwner ? (ownerAllowed[0] || "/") : (NAV.find((n) => !n.roles || n.roles.includes(role))?.href || "/login");
      router.replace(fallback);
    }
  }, [role, path, router, isOwner, ownerAllowed]);

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
            {isOwner && plan && <SubPill plan={plan} daysLeft={daysLeft} expired={isExpired} t={t} compact />}
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
            {isOwner && plan && <SubPill plan={plan} daysLeft={daysLeft} expired={isExpired} t={t} />}
            <div className="user-badge">
              <span>{name}</span>
              {role && <span className="user-role">{isOwner && plan ? PLAN_LABEL[plan] : ROLE_LABEL[role]}</span>}
            </div>
            <button className="btn-logout" onClick={logout}>{t("Logout")}</button>
          </div>
        </div>

        {isExpired && (
          <div className="sub-expired-banner">
            ⏳ {t("Your subscription has ended — read-only mode. Contact us to renew.")}
          </div>
        )}
        {children}
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

// Countdown / plan pill shown to Owners. Green while active, amber when
// under a week, red once expired.
function SubPill({ plan, daysLeft, expired, t, compact }: {
  plan: Plan; daysLeft: number | null; expired: boolean; t: (k: string) => string; compact?: boolean;
}) {
  const color = expired ? "#f87171" : daysLeft != null && daysLeft <= 7 ? "#fbbf24" : "#34d399";
  const label = expired
    ? t("Expired")
    : daysLeft == null
    ? t("Unlimited")
    : `${daysLeft} ${t("days left")}`;
  return (
    <span title={PLAN_LABEL[plan]} style={{
      display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      padding: compact ? "3px 8px" : "5px 11px", borderRadius: 999,
      fontSize: compact ? 10.5 : 12, fontWeight: 700,
      background: `${color}1a`, color, border: `1px solid ${color}44`,
    }}>
      {!compact && <span style={{ opacity: .85 }}>{PLAN_LABEL[plan]} ·</span>} {label}
    </span>
  );
}
