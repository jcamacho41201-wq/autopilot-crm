import Link from "next/link";
import { Gauge, LogIn } from "lucide-react";
import { loginAction } from "@/lib/actions";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="auth-page">
      <div className="auth-box panel">
        <Link className="brand" href="/">
          <span className="brand-mark"><Gauge /></span>
          AutoPilot CRM
        </Link>
        <h1 style={{ fontSize: "2rem", marginTop: 24 }}>Log in</h1>
        <p>Use `owner@autopilot.local` and `password123` after seeding the demo database.</p>
        {searchParams.error ? <p className="badge danger" style={{ whiteSpace: "normal" }}>{searchParams.error}</p> : null}
        <form className="form" action={loginAction}>
          <label>Email<input name="email" type="email" defaultValue="owner@autopilot.local" required /></label>
          <label>Password<input name="password" type="password" defaultValue="password123" required /></label>
          <button className="button" type="submit"><LogIn /> Log in</button>
        </form>
        <p>New shop? <Link href="/signup">Create an account</Link></p>
      </div>
    </main>
  );
}
