import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Car, Mail, Phone, Plus, Save, Trash2, Wrench } from "lucide-react";
import {
  createServiceRecordAction,
  createVehicleAction,
  deleteCustomerAction,
  deleteVehicleAction,
  updateCustomerAction,
  updateVehicleAction
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, money, yyyyMmDd } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { estimateAnnualMiles, maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

export default async function CustomerDashboardPage({ params, searchParams }: { params: { customerId: string }; searchParams: { error?: string } }) {
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
  const customerPath = `/app/customers/${customer.id}`;

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
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

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
                  <details className="card detail-card" key={vehicle.id}>
                    <summary>
                      <div>
                        <h3><Car size={17} /> {vehicle.year} {vehicle.make} {vehicle.model}</h3>
                        <p>{vehicle.vehicleType ?? "Vehicle"} · {vehicle.currentMileage.toLocaleString()} mi · {annualMiles.toLocaleString()} learned miles/year</p>
                      </div>
                      <span className={`badge ${vehicleScore < 35 ? "danger" : vehicleScore < 60 ? "warn" : "ok"}`}>{vehicleScore}/100</span>
                    </summary>
                    <div className="list" style={{ marginTop: 12 }}>
                      {vehicleRows.slice(0, 4).map(({ item, prediction }) => (
                        <div className="mini-row" key={item.id}>
                          <span>{item.name}</span>
                          <span className={prediction.isOverdue ? "badge danger" : prediction.shouldRemind ? "badge warn" : "badge ok"}>{prediction.remainingLifePercentage}% life · due {prediction.dueMileage.toLocaleString()} mi</span>
                        </div>
                      ))}
                    </div>
                    <form className="form" action={updateVehicleAction} style={{ marginTop: 14 }}>
                      <input type="hidden" name="vehicleId" value={vehicle.id} />
                      <input type="hidden" name="returnTo" value={customerPath} />
                      <div className="form-row">
                        <label>Year<input name="year" type="number" defaultValue={vehicle.year} required /></label>
                        <label>Type<input name="vehicleType" defaultValue={vehicle.vehicleType ?? ""} placeholder="SUV" /></label>
                      </div>
                      <div className="form-row">
                        <label>Make<input name="make" defaultValue={vehicle.make} required /></label>
                        <label>Model<input name="model" defaultValue={vehicle.model} required /></label>
                      </div>
                      <div className="form-row">
                        <label>Mileage<input name="currentMileage" type="number" min={0} defaultValue={vehicle.currentMileage} required /></label>
                        <label>Driving profile<input name="estimatedMilesYear" type="number" min={0} defaultValue={annualMiles} /></label>
                      </div>
                      <div className="form-row">
                        <label>VIN<input name="vin" defaultValue={vehicle.vin ?? ""} /></label>
                        <label>Plate<input name="licensePlate" defaultValue={vehicle.licensePlate ?? ""} /></label>
                      </div>
                      <label>Vehicle notes<textarea name="notes" defaultValue={vehicle.notes ?? ""} /></label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
                      <button className="button secondary" type="submit"><Save /> Save vehicle</button>
                    </form>
                    <form className="form danger-zone" action={deleteVehicleAction}>
                      <input type="hidden" name="vehicleId" value={vehicle.id} />
                      <input type="hidden" name="returnTo" value={customerPath} />
                      <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmDelete" /> Delete this vehicle and its service history</label>
                      <button className="button danger-button" type="submit"><Trash2 /> Delete vehicle</button>
                    </form>
                  </details>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <h2>Add Vehicle</h2>
            <form className="form" action={createVehicleAction}>
              <input type="hidden" name="customerId" value={customer.id} />
              <input type="hidden" name="returnTo" value={customerPath} />
              <div className="form-row">
                <label>Year<input name="year" type="number" required /></label>
                <label>Type<input name="vehicleType" placeholder="Truck" /></label>
              </div>
              <div className="form-row">
                <label>Make<input name="make" required /></label>
                <label>Model<input name="model" required /></label>
              </div>
              <div className="form-row">
                <label>Mileage<input name="currentMileage" type="number" min={0} required /></label>
                <label>Driving profile<input name="estimatedMilesYear" type="number" min={0} defaultValue={12000} /></label>
              </div>
              <div className="form-row">
                <label>VIN<input name="vin" /></label>
                <label>Plate<input name="licensePlate" /></label>
              </div>
              <label>Vehicle notes<textarea name="notes" /></label>
              <button className="button" type="submit"><Plus /> Add vehicle</button>
            </form>
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
                    <p>{dateLabel(record.serviceDate)} · {record.vehicle.year} {record.vehicle.make} {record.vehicle.model} · {record.mileage.toLocaleString()} mi · {record.notes ?? "No notes"}</p>
                    {record.nextRecommendedService ? <p>Next: {record.nextRecommendedService}{record.nextRecommendedMileage ? ` at ${record.nextRecommendedMileage.toLocaleString()} mi` : ""}</p> : null}
                  </div>
                  <span className="badge">{money.format(record.revenue)}</span>
                </div>
              )) : <p>No service records yet.</p>}
            </div>
          </div>

          <div className="panel">
            <h2>Create Service Record</h2>
            <form className="form" action={createServiceRecordAction}>
              <input type="hidden" name="returnTo" value={customerPath} />
              <label>Vehicle
                <select name="vehicleId" required>
                  {customer.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.year} {vehicle.make} {vehicle.model}</option>)}
                </select>
              </label>
              <div className="form-row">
                <label>Date<input name="serviceDate" type="date" defaultValue={yyyyMmDd(new Date())} required /></label>
                <label>Mileage<input name="mileage" type="number" min={0} required /></label>
              </div>
              <label>Service performed<input name="summary" required placeholder="Oil change and tire rotation" /></label>
              <label>Notes<textarea name="notes" /></label>
              <div className="form-row">
                <label>Price<input name="revenue" type="number" min={0} step="0.01" defaultValue={0} /></label>
                <label>Next mileage<input name="nextRecommendedMileage" type="number" min={0} /></label>
              </div>
              <label>Next recommended service<input name="nextRecommendedService" placeholder="Brake inspection" /></label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
              <button className="button" type="submit"><Wrench /> Add service record</button>
            </form>
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

          <form className="panel form danger-zone" action={deleteCustomerAction}>
            <h2>Delete Customer</h2>
            <input type="hidden" name="customerId" value={customer.id} />
            <input type="hidden" name="returnTo" value={customerPath} />
            <p>Deleting this customer also deletes {customer.vehicles.length} vehicle profile{customer.vehicles.length === 1 ? "" : "s"}, service history, maintenance items, appointments, and opportunities tied to those vehicles.</p>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmDelete" /> I understand and want to delete this customer</label>
            <button className="button danger-button" type="submit"><Trash2 /> Delete customer</button>
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
