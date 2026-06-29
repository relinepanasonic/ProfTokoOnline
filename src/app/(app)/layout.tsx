"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Role = "superadmin" | "client_admin" | "branch_manager" | "store_user";

const NAV: { href: string; icon: string; label: string; roles?: Role[] }[] = [
  { href: "/",          icon: "📊", label: "Dashboard",           roles: ["superadmin", "branch_manager"] },
  { href: "/upload",    icon: "⬆️", label: "Upload Data",         roles: ["superadmin", "client_admin"] },
  { href: "/product",   icon: "📦", label: "Product Performance", roles: ["superadmin", "branch_manager"] },
  { href: "/ads",       icon: "🎯", label: "Ads Performance",     roles: ["superadmin", "branch_manager"] },
  { href: "/store",     icon: "🏬", label: "Store Performance",   roles: ["superadmin", "branch_manager"] },
  { href: "/users",     icon: "👥", label: "Users",               roles: ["superadmin"] },
  { href: "/invoice",   icon: "🧾", label: "Invoice",             roles: ["superadmin"] },
  { href: "/core",      icon: "🗂️", label: "Core List",          roles: ["superadmin", "client_admin"] },
  { href: "/calc",      icon: "🧮", label: "Price Calculator",    roles: ["superadmin", "branch_manager"] },
  { href: "/marketfee", icon: "💰", label: "Market Place Fee",    roles: ["superadmin", "branch_manager", "client_admin"] },
  { href: "/priceall",  icon: "📋", label: "Price All User",      roles: ["superadmin"] },
];

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  client_admin: "Client Admin",
  branch_manager: "Owner",
  store_user: "Store",
};

// Mobile bottom-nav: 6 most-used destinations
const BOTTOM = ["/", "/product", "/ads", "/store", "/upload", "/calc"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [supabase] = useState(() => createClient());
  const [role, setRole] = useState<Role>();
  const [name, setName] = useState("—");
  const [clientName, setClientName] = useState("Panasonic");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase
        .from("profiles").select("role, display_name, client_id").eq("id", user.id).single();
      if (p) {
        setRole(p.role as Role);
        setName(p.display_name || user.email?.split("@")[0] || "User");
        if (p.client_id) {
          const { data: c } = await supabase.from("clients").select("name").eq("id", p.client_id).single();
          if (c?.name) setClientName(c.name);
        }
      }
    })();
  }, [supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const visible = NAV.filter((n) => !n.roles || (role && n.roles.includes(role)));
  const current = NAV.find((n) => n.href === path);

  return (
    <div className="app">
      {/* Sidebar (desktop) */}
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <img src="/logo.svg" alt="logo" style={{ width: 36, height: 36, objectFit: "contain" }} />
          </div>
          <div>
            <div className="t1">Reline</div>
            <div className="t2">{clientName}</div>
          </div>
        </div>
        <ul className="nav-list">
          {visible.map((n) => (
            <li key={n.href} className={path === n.href ? "active" : ""}>
              <Link href={n.href} style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", color: "inherit", textDecoration: "none" }}>
                <span className="ic">{n.icon}</span> {n.label}
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
            <div className="badge">R</div>
            <div>
              <div className="mob-title">Reline</div>
              <div className="mob-sub">{clientName}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={logout}>Logout</button>
        </div>

        {/* Desktop topbar */}
        <div className="topbar">
          <div>
            <div className="page-title">{current?.label || "Dashboard"}</div>
            <div className="page-sub">Marketplace performance overview — Shopee</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="user-badge">
              <span>{name}</span>
              {role && <span className="user-role">{ROLE_LABEL[role]}</span>}
            </div>
            <button className="btn-logout" onClick={logout}>Logout</button>
          </div>
        </div>

        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        {BOTTOM.filter((href) => visible.some((v) => v.href === href)).map((href) => {
          const n = NAV.find((x) => x.href === href)!;
          return (
            <Link key={href} href={href} className={`bn-item ${path === href ? "active" : ""}`}>
              <span style={{ fontSize: 20 }}>{n.icon}</span>
              <span>{n.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
