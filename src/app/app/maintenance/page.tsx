import { CheckCircle2, Gauge, Plus } from "lucide-react";
import { addMileageAction, completeServiceAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";
import { dateLabel, money, yyyyMmDd } from "@/lib/format";

export default async function MaintenancePage() {
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
                    <thead><tr><th>Service</th><th>Remaining</th><th>Due</th><th>Complete</th></tr></thead>
                    <tbody>
                      {rows.map(({ item, prediction }) => (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong><br /><span className="muted">{money.format(item.averagePrice)} avg</span></td>
                          <td>
                            <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                            <small>{prediction.remainingLifePercentage}% · mileage {prediction.mileageRemainingPct}% · time {prediction.timeRemainingPct}%</small>
                          </td>
                          <td><span className={`badge ${prediction.isOverdue ? "danger" : prediction.shouldRemind ? "warn" : "ok"}`}>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</span><br /><span className="muted">{prediction.dueMileage.toLocaleString()} mi</span></td>
                          <td>
                            <form className="form compact-form" action={completeServiceAction}>
                              <input type="hidden" name="maintenanceId" value={item.id} />
                              <input type="hidden" name="serviceDate" value={yyyyMmDd(new Date())} />
                              <input name="mileage" type="number" defaultValue={prediction.currentMileage} aria-label="Mileage" />
                              <input name="revenue" type="number" defaultValue={item.averagePrice} aria-label="Revenue" />
                              <input name="deferredDescription" placeholder="Deferred work, optional" aria-label="Deferred work" />
                              <input name="deferredRevenue" type="number" placeholder="$" aria-label="Deferred revenue" />
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
            <label>Mileage<input name="mileage" type="number" required /></label>
            <label>Date<input name="loggedAt" type="date" defaultValue={yyyyMmDd(new Date())} /></label>
            <label>Source<select name="source"><option>service</option><option>phone update</option><option>inspection</option></select></label>
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
