import Link from "next/link";
import { Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { AppNav } from "./app-nav";
import { GlobalSearch } from "./global-search";

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
        <AppNav />
      </aside>
      <main className="main">
        <GlobalSearch />
        {children}
      </main>
    </div>
  );
}
