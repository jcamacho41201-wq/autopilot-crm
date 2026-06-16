import Link from "next/link";
import { Check, Gauge } from "lucide-react";

const tiers = [
  ["Starter", "$99", "Core CRM, dashboard, reminders, and booking."],
  ["Growth", "$249", "Forecasting, inventory intelligence, and team workflows."],
  ["Pro", "$499", "Multi-location ready structure, advanced capacity planning, and priority support."]
];

export default function PricingPage() {
  return (
    <main className="marketing-page">
      <nav className="marketing-nav" style={{ color: "var(--ink)", position: "static" }}>
        <Link className="brand" href="/">
          <span className="brand-mark"><Gauge /></span>
          AutoPilot CRM
        </Link>
        <Link className="button" href="/signup">Start trial</Link>
      </nav>
      <section className="section">
        <p className="eyebrow">Subscription-ready pricing</p>
        <h1>Plans for repair shops that want tomorrow’s work booked today.</h1>
      </section>
      <section className="section grid grid-3">
        {tiers.map(([name, price, copy]) => (
          <article className="panel" key={name}>
            <h2>{name}</h2>
            <p><strong style={{ fontSize: "2rem", color: "var(--ink)" }}>{price}</strong> / month</p>
            <p>{copy}</p>
            <div className="list">
              {["Tenant-scoped shop data", "Role permissions", "Stripe-ready plan field"].map((item) => (
                <span className="row" key={item} style={{ justifyContent: "flex-start" }}>
                  <Check size={17} /> {item}
                </span>
              ))}
            </div>
            <Link className="button" href={`/signup?plan=${name}`} style={{ marginTop: 18 }}>Choose {name}</Link>
          </article>
        ))}
      </section>
    </main>
  );
}
