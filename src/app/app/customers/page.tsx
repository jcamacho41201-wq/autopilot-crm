import { Plus, UserPlus } from "lucide-react";
import { createCustomerAction, createVehicleAction } from "@/lib/actions";
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
          <p>Create customers, attach vehicles, capture preferences, and seed maintenance plans.</p>
        </div>
      </header>

      <section className="split">
        <div className="panel">
          <h2>Customer List</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Contact</th><th>Preferences</th><th>Vehicles</th><th>Notes</th></tr></thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td><strong>{customer.name}</strong></td>
                    <td>{customer.phone}<br /><span className="muted">{customer.email}</span></td>
                    <td><span className="badge">{customer.communicationPrefs}</span></td>
                    <td>
                      {customer.vehicles.map((vehicle) => (
                        <div key={vehicle.id}>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.currentMileage.toLocaleString()} mi</div>
                      ))}
                    </td>
                    <td>{customer.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="grid">
          <form className="panel form" action={createCustomerAction}>
            <h2>Add Customer</h2>
            <label>Name<input name="name" required /></label>
            <label>Phone<input name="phone" required /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Communication preference
              <select name="communicationPrefs"><option>SMS</option><option>Email</option><option>SMS + email</option><option>Phone</option></select>
            </label>
            <label>Notes<textarea name="notes" /></label>
            <button className="button" type="submit"><UserPlus /> Add customer</button>
          </form>

          <form className="panel form" action={createVehicleAction}>
            <h2>Add Vehicle</h2>
            <label>Customer
              <select name="customerId" required>
                {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label>Year<input name="year" type="number" required /></label>
              <label>Make<input name="make" required /></label>
            </div>
            <label>Model<input name="model" required /></label>
            <div className="form-row">
              <label>VIN<input name="vin" /></label>
              <label>Plate<input name="licensePlate" /></label>
            </div>
            <div className="form-row">
              <label>Current mileage<input name="currentMileage" type="number" required /></label>
              <label>Est. miles/year<input name="estimatedMilesYear" type="number" defaultValue={12000} /></label>
            </div>
            <button className="button" type="submit"><Plus /> Add vehicle</button>
          </form>
        </aside>
      </section>
    </>
  );
}
