import Link from "next/link";
import { Rocket, Wrench } from "lucide-react";
import { signupAction } from "@/lib/actions";

export default function SignupPage({ searchParams }: { searchParams: { plan?: string } }) {
  return (
    <main className="auth-page">
      <div className="auth-box panel">
        <Link className="brand" href="/">
          <span className="brand-mark"><Wrench /></span>
          Maintiva
        </Link>
        <h1 style={{ fontSize: "2rem", marginTop: 24 }}>Create your shop</h1>
        <p>Set up a tenant account, owner login, default services, reminder rules, and booking link.</p>
        <form className="form" action={signupAction}>
          <label>Shop name<input name="shopName" required placeholder="Northside Auto Care" /></label>
          <label>Your name<input name="name" required placeholder="Avery Owner" /></label>
          <label>Email<input name="email" type="email" required placeholder="owner@shop.com" /></label>
          <label>Password<input name="password" type="password" required minLength={8} /></label>
          <label>Plan
            <select name="plan" defaultValue={searchParams.plan ?? "Starter"}>
              <option>Starter</option>
              <option>Growth</option>
              <option>Pro</option>
            </select>
          </label>
          <button className="button" type="submit"><Rocket /> Start trial</button>
        </form>
      </div>
    </main>
  );
}
