import { CheckCircle2, Gauge, Plus } from "lucide-react";
import { addMileageAction, completeServiceAction, deleteMaintenanceItemAction, updateMaintenanceItemAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";
import { dateLabel, money, yyyyMmDd } from "@/lib/format";

export default async function MaintenancePage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requireUser();
  const [vehicles, maintenance] = await Promise.all([
    prisma.vehicle.findMany({
      where: { customer: { shopId: user.shopId } },
      include: { customer: true, mileageLogs: { orderBy: { loggedAt: "desc" } } },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: { vehicle: { include: { customer: true, mileageLogs: true } } },
      orderBy: { name: "asc" }
    })
  ]);
  const ranked = (maintenance as MaintenanceWithVehicle[])
    .map((item) => ({ item, prediction: maintenancePrediction(item) }))
    .sort((a, b) => a.prediction.remainingLifePercentage - b.prediction.remainingLifePercentage);
  const grouped = vehicles
    .map((vehicle) => {
      const rows = ranked.filter(({ item }) => item.vehicleId === vehicle.id);
      const lowestLife = rows.length ? Math.min(...rows.map((row) => row.prediction.remainingLifePercentage)) : 100;
      const nextDue = rows.length ? rows[0] : null;
      const value = rows
        .filter((row) => row.prediction.shouldRemind || row.prediction.isOverdue)
        .reduce((sum, row) => sum + row.item.averagePrice, 0);
      return { vehicle, rows, lowestLife, nextDue, value };
    })
    .sort((a, b) => a.lowestLife - b.lowestLife);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Prediction engine</p>
          <h1>Maintenance Tracking</h1>
          <p>Learn mileage habits, calculate remaining life from mileage and time, and convert due work into revenue.</p>
        </div>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="split">
        <div className="panel">
          <h2>Predicted Maintenance Queue</h2>
          <div className="list">
            {grouped.map(({ vehicle, rows, lowestLife, nextDue, value }) => (
              <details className="vehicle-queue-card" key={vehicle.id}>
                <summary>
                  <div>
                    <strong>{vehicle.customer.name}</strong>
                    <p>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.vehicleType ?? "Vehicle"} · {vehicle.currentMileage.toLocaleString()} mi</p>
                  </div>
                  <div className="queue-summary">
                    <span className={`badge ${lowestLife < 20 ? "danger" : lowestLife < 45 ? "warn" : "ok"}`}>{lowestLife}% lowest life</span>
                    <span className="badge">{rows.length} services</span>
                    <span className="badge warn">{money.format(value)} due value</span>
                  </div>
                </summary>
                {nextDue ? (
                  <div className="queue-preview">
                    <span>Next up: <strong>{nextDue.item.name}</strong></span>
                    <span className={nextDue.prediction.isOverdue ? "badge danger" : nextDue.prediction.shouldRemind ? "badge warn" : "badge ok"}>
                      {nextDue.prediction.isOverdue ? "Overdue" : dateLabel(nextDue.prediction.dueDate)}
                    </span>
                    <span>{nextDue.prediction.annualMiles.toLocaleString()} learned miles/year</span>
                  </div>
                ) : null}
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Service</th><th>Remaining</th><th>Due</th><th>Edit / Complete</th></tr></thead>
                    <tbody>
                      {rows.map(({ item, prediction }) => (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong><br /><span className="muted">{money.format(item.averagePrice)} avg · {item.status}</span></td>
                          <td>
                            <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                            <small>{prediction.remainingLifePercentage}% · mileage {prediction.mileageRemainingPct}% · time {prediction.timeRemainingPct}%</small>
                          </td>
                          <td><span className={`badge ${prediction.isOverdue ? "danger" : prediction.shouldRemind ? "warn" : "ok"}`}>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</span><br /><span className="muted">{prediction.dueMileage.toLocaleString()} mi</span></td>
                          <td>
                            <details className="inline-details">
                              <summary className="button ghost">Edit</summary>
                              <form className="form compact-form" action={updateMaintenanceItemAction}>
                                <input type="hidden" name="maintenanceId" value={item.id} />
                                <input type="hidden" name="returnTo" value="/app/maintenance" />
                                <label>Service type<input name="name" defaultValue={item.name} required /></label>
                                <div className="form-row">
                                  <label>Mileage interval<input name="mileageInterval" type="number" min={1} defaultValue={item.mileageInterval} required /></label>
                                  <label>Time interval months<input name="timeIntervalMonths" type="number" min={1} defaultValue={item.timeIntervalMonths} required /></label>
                                </div>
                                <div className="form-row">
                                  <label>Estimated price<input name="averagePrice" type="number" min={0} step="0.01" defaultValue={item.averagePrice} /></label>
                                  <label>Status
                                    <select name="status" defaultValue={item.status}>
                                      <option>ACTIVE</option>
                                      <option>WATCH</option>
                                      <option>DUE</option>
                                      <option>DEFERRED</option>
                                      <option>PAUSED</option>
                                    </select>
                                  </label>
                                </div>
                                <div className="form-row">
                                  <label>Override due mileage<input name="overrideDueMileage" type="number" min={0} defaultValue={item.overrideDueMileage ?? ""} placeholder={prediction.dueMileage.toString()} /></label>
                                  <label>Override due date<input name="overrideDueDate" type="date" defaultValue={item.overrideDueDate ? yyyyMmDd(item.overrideDueDate) : ""} /></label>
                                </div>
                                <label>Notes<textarea name="customNotes" defaultValue={item.customNotes ?? ""} /></label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
                                <button className="button secondary" type="submit">Save item</button>
                              </form>
                              <form className="form danger-zone" action={deleteMaintenanceItemAction}>
                                <input type="hidden" name="maintenanceId" value={item.id} />
                                <input type="hidden" name="returnTo" value="/app/maintenance" />
                                <button className="button danger-button" type="submit">Delete item</button>
                              </form>
                            </details>
                            <form className="form compact-form" action={completeServiceAction}>
                              <input type="hidden" name="maintenanceId" value={item.id} />
                              <input type="hidden" name="returnTo" value="/app/maintenance" />
                              <label>Date<input name="serviceDate" type="date" defaultValue={yyyyMmDd(new Date())} /></label>
                              <input name="summary" defaultValue={`${item.name} completed`} aria-label="Service performed" />
                              <input name="mileage" type="number" min={0} defaultValue={prediction.currentMileage} aria-label="Mileage" required />
                              <input name="revenue" type="number" min={0} step="0.01" defaultValue={item.averagePrice} aria-label="Revenue" />
                              <input name="notes" placeholder="Service notes" aria-label="Service notes" />
                              <input name="deferredDescription" placeholder="Deferred work, optional" aria-label="Deferred work" />
                              <input name="deferredRevenue" type="number" placeholder="$" aria-label="Deferred revenue" />
                              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
                              <button className="button secondary" type="submit"><CheckCircle2 /> Complete</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </div>

        <aside className="grid">
          <form className="panel form" action={addMileageAction}>
            <h2>Add Mileage Reading</h2>
            <label>Vehicle
              <select name="vehicleId" required>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.customer.name} · {vehicle.year} {vehicle.make} {vehicle.model}</option>
                ))}
              </select>
            </label>
            <label>Mileage<input name="mileage" type="number" min={0} required /></label>
            <label>Date<input name="loggedAt" type="date" defaultValue={yyyyMmDd(new Date())} /></label>
            <label>Source<select name="source"><option>service</option><option>phone update</option><option>inspection</option></select></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
            <button className="button" type="submit"><Gauge /> Learn mileage</button>
          </form>

          <div className="panel">
            <h2>Vehicle Health Scores</h2>
            <div className="list">
              {vehicles.map((vehicle) => {
                const items = ranked.filter(({ item }) => item.vehicleId === vehicle.id);
                const avg = items.length ? Math.round(items.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / items.length) : 100;
                return (
                  <div className="card" key={vehicle.id}>
                    <div className="row">
                      <strong>{vehicle.year} {vehicle.make} {vehicle.model}</strong>
                      <span className={`badge ${avg < 25 ? "danger" : avg < 45 ? "warn" : "ok"}`}>{avg}/100</span>
                    </div>
                    <p>{vehicle.customer.name} · {vehicle.estimatedMilesYear.toLocaleString()} learned miles/year</p>
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
