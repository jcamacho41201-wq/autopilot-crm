"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="auth-box panel">
        <p className="eyebrow">Recovery mode</p>
        <h1 style={{ fontSize: "2rem" }}>AutoPilot CRM hit a server error</h1>
        <p>
          The most common cause is a production database that is missing the latest Prisma migrations
          or a missing `DATABASE_URL` environment variable.
        </p>
        {error.digest ? <p className="badge danger">Digest: {error.digest}</p> : null}
        <div className="row" style={{ justifyContent: "flex-start", marginTop: 16 }}>
          <button className="button" onClick={reset} type="button"><AlertTriangle /> Try again</button>
          <Link className="button secondary" href="/login">Login</Link>
        </div>
      </section>
    </main>
  );
}
