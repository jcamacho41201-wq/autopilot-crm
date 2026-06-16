"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, FileText, Gauge, LogOut, PackageSearch, Settings, Users, Wrench, MessageSquareText, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { logoutAction } from "@/lib/actions";

const nav: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/app", label: "Dashboard", Icon: BarChart3 },
  { href: "/app/customers", label: "Customers", Icon: Users },
  { href: "/app/maintenance", label: "Maintenance", Icon: Wrench },
  { href: "/app/quotes", label: "Quotes", Icon: FileText },
  { href: "/app/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/app/reminders", label: "Reminders", Icon: MessageSquareText },
  { href: "/app/forecast", label: "Forecast", Icon: Gauge },
  { href: "/app/inventory", label: "Inventory", Icon: PackageSearch },
  { href: "/app/team", label: "Team", Icon: UserCog },
  { href: "/app/settings", label: "Settings", Icon: Settings }
];

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {nav.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={href} href={href}>
            <Icon /> {label}
          </Link>
        );
      })}
      <form action={logoutAction}>
        <button type="submit"><LogOut /> Sign out</button>
      </form>
    </nav>
  );
}
