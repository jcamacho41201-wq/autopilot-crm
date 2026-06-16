import Link from "next/link";
import { PackageSearch, Save, UserPlus } from "lucide-react";
import { inviteUserAction, updateShopAction } from "@/lib/actions";
import { canManage, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function SettingsPage() {
  const user = await requireUser();
  const users = await prisma.user.findMany({ where: { shopId: user.shopId }, orderBy: { role: "asc" } });
  const isManager = canManage(user.role);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">SaaS settings</p>
          <h1>Shop Profile & Users</h1>
          <p>Manage plan fields, booking link, users, and role permissions. Payments can be added against this structure later.</p>
        </div>
      </header>
      <section className="split">
        <div className="panel">
          <h2>Users</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Permissions</th></tr></thead>
              <tbody>
                {users.map((shopUser) => (
                  <tr key={shopUser.id}>
                    <td>{shopUser.name}</td>
                    <td>{shopUser.email}</td>
                    <td><span className="badge">{shopUser.role}</span></td>
                    <td>{canManage(shopUser.role) ? "Manage shop, users, settings, and all records" : "Create service records, scan inventory, update appointments"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="grid">
          <div className="panel">
            <h2>Service Library</h2>
            <p>Manage reusable maintenance templates, default intervals, pricing, reminder thresholds, and service packages.</p>
            <Link className="button secondary" href="/app/settings/service-library"><PackageSearch /> Open Service Library</Link>
          </div>
          <form className="panel form" action={updateShopAction}>
            <h2>Shop Profile</h2>
            <label>Name<input name="name" defaultValue={user.shop.name} disabled={!isManager} /></label>
            <label>Plan
              <select name="plan" defaultValue={user.shop.plan} disabled={!isManager}>
                <option>Starter</option><option>Growth</option><option>Pro</option>
              </select>
            </label>
            <label>Booking link<input name="bookingLink" defaultValue={user.shop.bookingLink || `/booking/${user.shop.slug}`} disabled={!isManager} /></label>
            <button className="button" type="submit" disabled={!isManager}><Save /> Save profile</button>
          </form>
          <form className="panel form" action={inviteUserAction}>
            <h2>Add User</h2>
            <label>Name<input name="name" required disabled={!isManager} /></label>
            <label>Email<input name="email" type="email" required disabled={!isManager} /></label>
            <label>Temporary password<input name="password" defaultValue="password123" disabled={!isManager} /></label>
            <label>Role
              <select name="role" disabled={!isManager}>
                <option value="MECHANIC">Mechanic</option>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
            <button className="button secondary" type="submit" disabled={!isManager}><UserPlus /> Add user</button>
          </form>
        </aside>
      </section>
    </>
  );
}
