import Link from "next/link";
import { Plus, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function CustomersPage() {
  const user = await requireUser();
  const customers = await prisma.customer.findMany({
    where: { shopId: user.shopId },
    include: { vehicles: { include: { mileageLogs: true, maintenanceItems: true } } },
    orderBy: { createdAt: "desc" }
  });

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Customer CRM</p>
          <h1>Customers & Vehicles</h1>
          <p>Open a customer dashboard to edit details, review vehicles, and see upcoming maintenance in one place.</p>
        </div>
        <Link className="button" href="/app/customers/new"><Plus /> Add customer</Link>
      </header>

      <section>
        <div className="panel">
          <h2>Customer List</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Contact</th><th>Preferences</th><th>Vehicles</th><th>Notes</th></tr></thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link className="text-link" href={`/app/customers/${customer.id}`}>
                        <UserRound size={16} /> {customer.name}
                      </Link>
                    </td>
                    <td>{customer.phone}<br /><span className="muted">{customer.email}</span></td>
                    <td><span className="badge">{customer.communicationPrefs}</span></td>
                    <td>
                      {customer.vehicles.map((vehicle) => (
                        <div key={vehicle.id}>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.vehicleType ?? "Vehicle"} · {vehicle.currentMileage.toLocaleString()} mi</div>
                      ))}
                    </td>
                    <td>{customer.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
