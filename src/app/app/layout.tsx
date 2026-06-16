import Link from "next/link";
import { BarChart3, CalendarDays, Gauge, LogOut, PackageSearch, Settings, Users, Wrench, MessageSquareText, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { logoutAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";

const nav: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/app", label: "Dashboard", Icon: BarChart3 },
  { href: "/app/customers", label: "Customers", Icon: Users },
  { href: "/app/maintenance", label: "Maintenance", Icon: Wrench },
  { href: "/app/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/app/reminders", label: "Reminders", Icon: MessageSquareText },
  { href: "/app/forecast", label: "Forecast", Icon: Gauge },
  { href: "/app/inventory", label: "Inventory", Icon: PackageSearch },
  { href: "/app/team", label: "Team", Icon: UserCog },
  { href: "/app/settings", label: "Settings", Icon: Settings }
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/app">
          <span className="brand-mark"><Wrench /></span>
          <span>Maintiva</span>
        </Link>
        <div>
          <p className="eyebrow" style={{ color: "#9999aa" }}>{user.shop.name}</p>
          <span className="badge">{user.shop.plan} plan</span>
        </div>
        <nav className="nav">
          {nav.map(({ href, label, Icon }) => (
            <Link key={href} href={href}>
              <Icon /> {label}
            </Link>
          ))}
          <form action={logoutAction}>
            <button type="submit"><LogOut /> Sign out</button>
          </form>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
