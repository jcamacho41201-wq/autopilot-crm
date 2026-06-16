import Link from "next/link";
import { CalendarPlus, CheckCircle2, Gauge, MessageSquareText, Pencil, Plus, Wrench } from "lucide-react";
import {
  addMileageAction,
  completeServiceAction,
  createAppointmentAction,
  createMaintenanceItemAction,
  deleteMaintenanceItemAction,
  sendMockReminderAction,
  updateMaintenanceItemAction
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, dateTimeInputValue, money, yyyyMmDd } from "@/lib/format";
import { buildMaintenanceQueue, type MaintenanceQueueSource } from "@/lib/maintenanceQueue";
import { prisma } from "@/lib/prisma";

function nextAppointmentTime() {
  const date = new Date(Date.now() + 86400000);
  date.setHours(9, 0, 0, 0);
  return date;
}

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
      include: {
        vehicle: { include: { customer: true, mileageLogs: true } },
        reminders: { orderBy: { sentAt: "desc" }, take: 1 }
      },
      orderBy: { name: "asc" }
    })
  ]);
  const queue = buildMaintenanceQueue(maintenance as MaintenanceQueueSource[]);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Revenue opportunity queue</p>
          <h1>Maintenance</h1>
          <p>Prioritize which customers to contact today based on overdue work, due-soon services, and revenue potential.</p>
        </div>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Overdue Revenue</span><strong>{money.format(queue.kpis.overdueRevenue)}</strong><span className="badge danger">Past due</span></div>
        <div className="card stat"><span className="muted">Due Soon Revenue</span><strong>{money.format(queue.kpis.dueSoonRevenue)}</strong><span className="badge warn">Upcoming</span></div>
        <div className="card stat"><span className="muted">Open Opportunities</span><strong>{money.format(queue.kpis.openOpportunities)}</strong><span className="badge">Queue value</span></div>
        <div className="card stat"><span className="muted">Vehicles Due</span><strong>{queue.kpis.vehiclesDue}</strong><span className="badge">Needs review</span></div>
        <div className="card stat"><span className="muted">Customers Ready</span><strong>{queue.kpis.customersReady}</strong><span className="badge ok">Contact today</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>Predicted Maintenance Queue</h2>
          <div className="list">
            {queue.cards.length ? queue.cards.map((card) => {
              const highest = card.highestPriority;
              return (
                <details className="vehicle-queue-card" key={card.vehicle.id}>
                  <summary>
                    <div>
                      <strong>{card.customer.name}</strong>
                      <p>{card.vehicle.year} {card.vehicle.make} {card.vehicle.model} · {card.vehicle.currentMileage.toLocaleString()} mi</p>
                      <p>
                        {highest ? `${highest.prediction.status}: ${highest.item.name}` : "No active maintenance items"}
                        {card.latestReminder ? ` · Reminder ${card.latestReminder.status} ${dateLabel(card.latestReminder.sentAt)}` : " · No reminder sent"}
                      </p>
                      <div className="queue-actions">
                        <Link className="text-link" href={`/app/customers/${card.customer.id}`}>Open Customer Dashboard</Link>
                        <Link className="text-link" href={`/app/customers/${card.customer.id}#vehicle-${card.vehicle.id}`}>Open Vehicle Dashboard</Link>
                      </div>
                    </div>
                    <div className="queue-summary">
                      <span className="badge warn">{money.format(card.potentialRevenue)} potential</span>
                      <span className={`badge ${card.healthScore < 35 ? "danger" : card.healthScore < 60 ? "warn" : "ok"}`}>{card.healthScore}/100 health</span>
                      <span className="badge danger">{card.overdueCount} overdue</span>
                      <span className="badge warn">{card.dueCount + card.dueSoonCount} due soon</span>
                    </div>
                  </summary>

                  <div className="queue-preview">
                    <span><strong>Highest Priority Service:</strong> {highest?.item.name ?? "None"}</span>
                    <span><strong>Potential Revenue:</strong> {money.format(card.potentialRevenue)}</span>
                    <span><strong>Reminder Status:</strong> {card.latestReminder ? `${card.latestReminder.status} ${dateLabel(card.latestReminder.sentAt)}` : "Not sent"}</span>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Service</th><th>Status</th><th>Due Date</th><th>Due Mileage</th><th>Revenue</th><th>Remaining Life</th><th>Actions</th></tr></thead>
                      <tbody>
                        {card.rows.map(({ item, prediction }) => (
                          <tr key={item.id}>
                            <td><strong>{item.name}</strong><br /><span className="muted">{item.status}</span></td>
                            <td><span className={`badge ${prediction.statusTone}`}>{prediction.status}</span></td>
                            <td>{dateLabel(prediction.dueDate)}</td>
                            <td>{prediction.dueMileage.toLocaleString()} mi</td>
                            <td>{money.format(item.averagePrice)}</td>
                            <td>
                              <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                              <small>{prediction.remainingLifePercentage}% · current {prediction.currentMileage.toLocaleString()} mi</small>
                            </td>
                            <td>
                              <div className="queue-actions">
                                <form action={sendMockReminderAction}>
                                  <input type="hidden" name="maintenanceId" value={item.id} />
                                  <button className="button secondary" type="submit"><MessageSquareText /> Send Reminder</button>
                                </form>
                                <form action={createAppointmentAction}>
                                  <input type="hidden" name="customerId" value={card.customer.id} />
                                  <input type="hidden" name="vehicleId" value={card.vehicle.id} />
                                  <input type="hidden" name="scheduledAt" value={dateTimeInputValue(nextAppointmentTime())} />
                                  <input type="hidden" name="durationMinutes" value={60} />
                                  <input type="hidden" name="serviceName" value={item.name} />
                                  <input type="hidden" name="estimatedRevenue" value={item.averagePrice} />
                                  <input type="hidden" name="notes" value={`Booked from maintenance queue for ${item.name}.`} />
                                  <button className="button secondary" type="submit"><CalendarPlus /> Book Appointment</button>
                                </form>
                              </div>
                              <details className="inline-details">
                                <summary className="button ghost"><Pencil /> Edit Maintenance Item</summary>
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
                                  <div className="form-row">
                                    <label>Reminder threshold %<input name="reminderThresholdPercentage" type="number" min={0} max={100} defaultValue={item.reminderThresholdPercentage} /></label>
                                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="remindersEnabled" defaultChecked={item.remindersEnabled} /> Reminders enabled</label>
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
                              <details className="inline-details">
                                <summary className="button ghost"><CheckCircle2 /> Mark Complete</summary>
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
                                  <button className="button secondary" type="submit"><CheckCircle2 /> Complete Service</button>
                                </form>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            }) : <p>No customers are ready to contact right now. New due and overdue work will appear here automatically.</p>}
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

          <details className="panel inline-details">
            <summary className="button ghost"><Plus /> Add Maintenance Item</summary>
            <form className="form" action={createMaintenanceItemAction}>
              <label>Vehicle
                <select name="vehicleId" required>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>{vehicle.customer.name} · {vehicle.year} {vehicle.make} {vehicle.model}</option>
                  ))}
                </select>
              </label>
              <label>Service name<input name="name" required placeholder="Oil change" /></label>
              <div className="form-row">
                <label>Last completed date<input name="lastCompletedDate" type="date" defaultValue={yyyyMmDd(new Date())} /></label>
                <label>Last completed mileage<input name="lastCompletedMileage" type="number" min={0} defaultValue={vehicles[0]?.currentMileage ?? 0} /></label>
              </div>
              <div className="form-row">
                <label>Mileage interval<input name="mileageInterval" type="number" min={1} defaultValue={5000} /></label>
                <label>Time interval months<input name="timeIntervalMonths" type="number" min={1} defaultValue={6} /></label>
              </div>
              <div className="form-row">
                <label>Estimated price<input name="averagePrice" type="number" min={0} step="0.01" defaultValue={120} /></label>
                <label>Reminder threshold %<input name="reminderThresholdPercentage" type="number" min={0} max={100} defaultValue={20} /></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="remindersEnabled" defaultChecked /> Reminders enabled</label>
              <button className="button secondary" type="submit"><Wrench /> Add service</button>
            </form>
          </details>

          <div className="panel">
            <h2>Contact Priority</h2>
            <div className="list">
              {queue.cards.slice(0, 5).map((card, index) => (
                <div className="card" key={card.vehicle.id}>
                  <div className="row">
                    <strong>{index + 1}. {card.customer.name}</strong>
                    <span className="badge warn">{money.format(card.potentialRevenue)}</span>
                  </div>
                  <p>{card.vehicle.year} {card.vehicle.make} {card.vehicle.model} · {card.overdueCount} overdue · {card.dueSoonCount + card.dueCount} due soon</p>
                </div>
              ))}
              {!queue.cards.length ? <p>No priority contacts yet.</p> : null}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
