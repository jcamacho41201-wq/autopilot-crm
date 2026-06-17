import Link from "next/link";
import { ArrowRight, BarChart3, CalendarDays, Gauge, MessageSquareText, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

const features: { title: string; Icon: LucideIcon; copy: string; href: string }[] = [
  { title: "Forecast revenue", Icon: BarChart3, copy: "See booked, overdue, deferred, and predicted service revenue.", href: "/app/forecast" },
  { title: "Mileage learning", Icon: Gauge, copy: "Learn customer driving habits from every visit.", href: "/app/vehicles" },
  { title: "Reminder rules", Icon: MessageSquareText, copy: "Mock SMS reminders trigger from shop-defined thresholds.", href: "/app/reminders" },
  { title: "Booking calendar", Icon: CalendarDays, copy: "Public booking links and shop-side schedule planning.", href: "/app/calendar" }
];

export default async function HomePage() {
  const user = await currentUser();
  if (user) redirect("/app");

  return (
    <main className="marketing-page">
      <nav className="marketing-nav">
        <Link className="brand" href="/">
          <span className="brand-mark"><Wrench /></span>
          Maintiva
        </Link>
        <div className="row">
          <Link href="/pricing">Pricing</Link>
          <Link className="button" href="/signup">Start trial</Link>
        </div>
      </nav>
      <section className="marketing-hero">
        <div className="marketing-copy">
          <p className="eyebrow">Predict Maintenance. Drive Revenue.</p>
          <h1>Maintiva</h1>
          <p>
            Predictive maintenance, automated customer retention, and intelligent shop management
            for modern repair shops.
          </p>
          <div className="row" style={{ justifyContent: "flex-start" }}>
            <Link className="button" href="/signup">
              Create shop <ArrowRight />
            </Link>
            <Link className="button secondary" href="/login">Demo login</Link>
          </div>
        </div>
      </section>
      <section className="section grid grid-4">
        {features.map(({ title, Icon, copy, href }) => (
          <Link className="card clickable-card" href={href} key={title}>
            <Icon />
            <h3>{title}</h3>
            <p>{copy}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
