import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Car, Mail, Phone, Save, Wrench } from "lucide-react";
import { updateCustomerAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, money } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { estimateAnnualMiles, maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

export default async function CustomerDashboardPage({ params }: { params: { customerId: string } }) {
  const user = await requireUser();
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, shopId: user.shopId },
    include: {
      vehicles: {
        include: {
          mileageLogs: { orderBy: { loggedAt: "desc" } },
          maintenanceItems: true,
          serviceRecords: { orderBy: { serviceDate: "desc" }, take: 8 },
          appointments: { where: { status: "BOOKED" }, orderBy: { scheduledAt: "asc" }, take: 4 }
        },
        orderBy: { updatedAt: "desc" }
      }
    }
  });
  if (!customer) notFound();

  const maintenanceRows = customer.vehicles
    .flatMap((vehicle) =>
      vehicle.maintenanceItems.map((item) => {
        const itemWithVehicle = {
          ...item,
          vehicle: {
            ...vehicle,
            customer,
            mileageLogs: vehicle.mileageLogs
          }
        } as MaintenanceWithVehicle;
        return { vehicle, item, prediction: maintenancePrediction(itemWithVehicle) };
      })
    )
    .sort((a, b) => a.prediction.remainingLifePercentage - b.prediction.remainingLifePercentage);

  const customerScore = maintenanceRows.length
    ? Math.round(maintenanceRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / maintenanceRows.length)
    : 100;
  const recentService = customer.vehicles.flatMap((vehicle) =>
    vehicle.serviceRecords.map((record) => ({ ...record, vehicle }))
  ).sort((a, b) => b.serviceDate.getTime() - a.serviceDate.getTime()).slice(0, 8);
  const openMaintenance = maintenanceRows.filter((row) => row.prediction.shouldRemind || row.prediction.isOverdue).slice(0, 8);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Customer dashboard</p>
          <h1>{customer.name}</h1>
          <p>{customer.vehicles.length} vehicle{customer.vehicles.length === 1 ? "" : "s"} · {customer.communicationPrefs} preferred</p>
        </div>
        <Link className="button secondary" href="/app/customers"><ArrowLeft /> Customers</Link>
      </header>

      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Customer score</span><strong>{customerScore}/100</strong><span className={`badge ${customerScore < 35 ? "danger" : customerScore < 60 ? "warn" : "ok"}`}>Maintenance health</span></div>
        <div className="card stat"><span className="muted">Vehicles</span><strong>{customer.vehicles.length}</strong><span className="badge">Active profiles</span></div>
        <div className="card stat"><span className="muted">Open maintenance</span><strong>{openMaintenance.length}</strong><span className="badge warn">Needs attention</span></div>
        <div className="card stat"><span className="muted">Opportunity value</span><strong>{money.format(openMaintenance.reduce((sum, row) => sum + row.item.averagePrice, 0))}</strong><span className="badge">Predicted</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="grid">
          <div className="panel">
            <h2>Vehicles</h2>
            <div className="grid grid-2">
              {customer.vehicles.map((vehicle) => {
                const annualMiles = estimateAnnualMiles({ ...vehicle, mileageLogs: vehicle.mileageLogs });
                const vehicleRows = maintenanceRows.filter((row) => row.vehicle.id === vehicle.id);
                const vehicleScore = vehicleRows.length
                  ? Math.round(vehicleRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / vehicleRows.length)
                  : 100;
                return (
                  <article className="card" key={vehicle.id}>
                    <div className="row">
                      <h3><Car size={17} /> {vehicle.year} {vehicle.make} {vehicle.model}</h3>
                      <span className={`badge ${vehicleScore < 35 ? "danger" : vehicleScore < 60 ? "warn" : "ok"}`}>{vehicleScore}/100</span>
                    </div>
                    <p>{vehicle.vehicleType ?? "Vehicle"} · {vehicle.currentMileage.toLocaleString()} mi · {annualMiles.toLocaleString()} learned miles/year</p>
                    <div className="list">
                      {vehicleRows.slice(0, 4).map(({ item, prediction }) => (
                        <div className="mini-row" key={item.id}>
                          <span>{item.name}</span>
                          <span className={prediction.isOverdue ? "badge danger" : prediction.shouldRemind ? "badge warn" : "badge ok"}>{prediction.remainingLifePercentage}% life</span>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <h2>Upcoming Maintenance / Service Life</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Vehicle</th><th>Service</th><th>Life</th><th>Due</th><th>Value</th></tr></thead>
                <tbody>
                  {maintenanceRows.slice(0, 10).map(({ vehicle, item, prediction }) => (
                    <tr key={item.id}>
                      <td>{vehicle.year} {vehicle.make} {vehicle.model}</td>
                      <td><strong>{item.name}</strong></td>
                      <td>
                        <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                        <small>{prediction.remainingLifePercentage}% remaining</small>
                      </td>
                      <td><span className={prediction.isOverdue ? "badge danger" : prediction.shouldRemind ? "badge warn" : "badge ok"}>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</span></td>
                      <td>{money.format(item.averagePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Recent Service History</h2>
            <div className="list">
              {recentService.length ? recentService.map((record) => (
                <div className="card row" key={record.id}>
                  <div>
                    <strong>{record.summary}</strong>
                    <p>{dateLabel(record.serviceDate)} · {record.vehicle.year} {record.vehicle.make} {record.vehicle.model} · {record.mileage.toLocaleString()} mi</p>
                  </div>
                  <span className="badge">{money.format(record.revenue)}</span>
                </div>
              )) : <p>No service records yet.</p>}
            </div>
          </div>
        </div>

        <aside className="grid">
          <form className="panel form" action={updateCustomerAction}>
            <h2>Edit Customer</h2>
            <input type="hidden" name="customerId" value={customer.id} />
            <label>Name<input name="name" defaultValue={customer.name} required /></label>
            <label>Phone<input name="phone" defaultValue={customer.phone} required /></label>
            <label>Email<input name="email" type="email" defaultValue={customer.email ?? ""} /></label>
            <label>Communication preference
              <select name="communicationPrefs" defaultValue={customer.communicationPrefs}>
                <option>SMS</option>
                <option>Email</option>
                <option>SMS + email</option>
                <option>Phone</option>
              </select>
            </label>
            <label>Notes<textarea name="notes" defaultValue={customer.notes ?? ""} /></label>
            <button className="button" type="submit"><Save /> Save customer</button>
          </form>

          <div className="panel">
            <h2>Contact Info</h2>
            <div className="list">
              <div className="mini-row"><span><Phone size={16} /> Phone</span><strong>{customer.phone}</strong></div>
              <div className="mini-row"><span><Mail size={16} /> Email</span><strong>{customer.email ?? "Not set"}</strong></div>
              <div className="mini-row"><span><Wrench size={16} /> Preference</span><strong>{customer.communicationPrefs}</strong></div>
            </div>
          </div>

          <div className="panel">
            <h2>Driving Profile</h2>
            <div className="list">
              {customer.vehicles.map((vehicle) => {
                const annualMiles = estimateAnnualMiles({ ...vehicle, mileageLogs: vehicle.mileageLogs });
                return (
                  <div className="card" key={vehicle.id}>
                    <strong>{vehicle.year} {vehicle.make} {vehicle.model}</strong>
                    <p>{annualMiles.toLocaleString()} miles/year · {vehicle.mileageLogs.length} mileage readings · last reading {vehicle.mileageLogs[0]?.mileage.toLocaleString() ?? vehicle.currentMileage.toLocaleString()} mi</p>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
