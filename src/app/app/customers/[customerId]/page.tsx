import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, Car, Mail, MessageSquareText, Phone, Plus, Save, Trash2, Wrench } from "lucide-react";
import {
  createServiceRecordAction,
  deleteServiceRecordAction,
  createVehicleAction,
  deleteCustomerAction,
  updateServiceRecordAction,
  deleteVehicleAction,
  updateCustomerAction,
  updateVehicleAction
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, money, yyyyMmDd } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { estimateAnnualMiles, maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

function scoreLabel(score: number) {
  if (score >= 85) return "A+ Customer";
  if (score >= 65) return "Reliable Customer";
  if (score >= 40) return "At Risk";
  return "Inactive";
}

function clampScore(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function phoneHref(value: string, scheme: "tel" | "sms") {
  const digits = value.replace(/[^\d+]/g, "");
  return `${scheme}:${digits || value}`;
}

export default async function CustomerDashboardPage({ params, searchParams }: { params: { customerId: string }; searchParams: { error?: string } }) {
  const user = await requireUser();
  const [customer, reminderLogs] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: params.customerId, shopId: user.shopId },
      include: {
        vehicles: {
          include: {
            mileageLogs: { orderBy: { loggedAt: "desc" } },
            maintenanceItems: true,
            serviceRecords: { orderBy: { serviceDate: "desc" }, take: 8 },
            appointments: { orderBy: { scheduledAt: "asc" }, take: 12 },
            opportunities: { where: { status: "OPEN" } }
          },
          orderBy: { updatedAt: "desc" }
        },
      }
    }),
    prisma.reminderLog.findMany({
      where: { customerId: params.customerId },
      orderBy: { sentAt: "desc" },
      take: 25
    })
  ]);
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

  const recentService = customer.vehicles.flatMap((vehicle) =>
    vehicle.serviceRecords.map((record) => ({ ...record, vehicle }))
  ).sort((a, b) => b.serviceDate.getTime() - a.serviceDate.getTime()).slice(0, 8);
  const openMaintenance = maintenanceRows.filter((row) => row.prediction.shouldRemind || row.prediction.isOverdue).slice(0, 8);
  const customerPath = `/app/customers/${customer.id}`;
  const lifetimeSpend = customer.lifetimeSpend || recentService.reduce((sum, record) => sum + record.revenue, 0);
  const lastVisit = recentService[0]?.serviceDate;
  const nextAppointment = customer.vehicles
    .flatMap((vehicle) => vehicle.appointments.map((appointment) => ({ ...appointment, vehicle })))
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= new Date())
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  const allAppointments = customer.vehicles.flatMap((vehicle) => vehicle.appointments);
  const bookedRevenue = allAppointments
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= new Date())
    .reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);
  const openOpportunity = customer.vehicles
    .flatMap((vehicle) => vehicle.opportunities)
    .reduce((sum, opportunity) => sum + opportunity.estimatedRevenue, 0);
  const forecastRevenue = openMaintenance.reduce((sum, row) => sum + row.item.averagePrice, 0);
  const completedAppointments = allAppointments.filter((appointment) => appointment.status === "COMPLETED").length;
  const missedAppointments = allAppointments.filter((appointment) => appointment.status === "CANCELLED").length;
  const appointmentAttendanceFactor = allAppointments.length
    ? clampScore((completedAppointments / Math.max(1, completedAppointments + missedAppointments)) * 20 || 12, 20)
    : 12;
  const lifetimeSpendFactor = clampScore((lifetimeSpend / 3000) * 25, 25);
  const reminderResponseFactor = reminderLogs.length
    ? clampScore((reminderLogs.filter((log) => log.status === "SENT" || log.status === "MOCK_SENT").length / reminderLogs.length) * 18, 18)
    : 10;
  const serviceFrequencyFactor = clampScore(recentService.length * 5.8, 29);
  const customerScore = lifetimeSpendFactor + appointmentAttendanceFactor + reminderResponseFactor + serviceFrequencyFactor;
  const highPriority = maintenanceRows.filter((row) => row.prediction.status === "Overdue" || row.prediction.status === "Due");
  const mediumPriority = maintenanceRows.filter((row) => row.prediction.status === "Due Soon");
  const lowPriority = maintenanceRows.filter((row) => row.prediction.status === "Healthy" && row.prediction.remainingLifePercentage <= 80);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Customer dashboard</p>
          <h1>{customer.name}</h1>
          <p>{customer.vehicles.length} vehicle{customer.vehicles.length === 1 ? "" : "s"} · {customer.communicationPrefs} preferred · {scoreLabel(customerScore)}</p>
        </div>
        <Link className="button secondary" href="/app/customers"><ArrowLeft /> Customers</Link>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Customer score</span><strong>{customerScore}/100</strong><span className={`badge ${customerScore < 35 ? "danger" : customerScore < 60 ? "warn" : "ok"}`}>{scoreLabel(customerScore)}</span></div>
        <div className="card stat"><span className="muted">Lifetime spend</span><strong>{money.format(lifetimeSpend)}</strong><span className="badge">Recorded work</span></div>
        <div className="card stat"><span className="muted">Open opportunity</span><strong>{money.format(openOpportunity)}</strong><span className="badge warn">Deferred</span></div>
        <div className="card stat"><span className="muted">Booked revenue</span><strong>{money.format(bookedRevenue)}</strong><span className="badge">Scheduled</span></div>
      </section>
      <section className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="muted">Forecast revenue</span><strong>{money.format(forecastRevenue)}</strong><span className="badge warn">{openMaintenance.length} predicted</span></div>
        <div className="card stat"><span className="muted">Lifetime spend</span><strong>+{lifetimeSpendFactor}</strong><span className="badge">Score factor</span></div>
        <div className="card stat"><span className="muted">Attendance</span><strong>+{appointmentAttendanceFactor}</strong><span className="badge">Score factor</span></div>
        <div className="card stat"><span className="muted">Reminder response</span><strong>+{reminderResponseFactor}</strong><span className="badge">Score factor</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="grid">
          <div className="panel">
            <h2>Vehicles</h2>
            <div className="grid grid-2">
              {customer.vehicles.length ? customer.vehicles.map((vehicle) => {
                const annualMiles = estimateAnnualMiles({ ...vehicle, mileageLogs: vehicle.mileageLogs });
                const vehicleRows = maintenanceRows.filter((row) => row.vehicle.id === vehicle.id);
                const vehicleScore = vehicleRows.length
                  ? Math.round(vehicleRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / vehicleRows.length)
                  : 100;
                const overdueCount = vehicleRows.filter((row) => row.prediction.status === "Overdue").length;
                const dueCount = vehicleRows.filter((row) => row.prediction.status === "Due").length;
                const dueSoonCount = vehicleRows.filter((row) => row.prediction.status === "Due Soon").length;
                const healthyCount = vehicleRows.filter((row) => row.prediction.status === "Healthy").length;
                const potentialRevenue = vehicleRows
                  .filter((row) => row.prediction.status !== "Healthy")
                  .reduce((sum, row) => sum + row.item.averagePrice, 0);
                const openVehicleOpportunity = vehicle.opportunities.reduce((sum, opportunity) => sum + opportunity.estimatedRevenue, 0);
                return (
                  <details className="card detail-card" key={vehicle.id}>
                    <summary>
                      <div>
                        <h3><Car size={17} /> {vehicle.year} {vehicle.make} {vehicle.model}</h3>
                        <p>{vehicle.trim ? `${vehicle.trim} · ` : ""}{vehicle.vehicleType ?? "Vehicle"} · {vehicle.currentMileage.toLocaleString()} mi · {annualMiles.toLocaleString()} learned miles/year</p>
                        <p>VIN {vehicle.vin ?? "not set"} · Plate {vehicle.licensePlate ?? "not set"} · Last service {vehicle.serviceRecords[0]?.mileage.toLocaleString() ?? "none"} mi</p>
                      </div>
                      <span className={`badge ${vehicleScore < 35 ? "danger" : vehicleScore < 60 ? "warn" : "ok"}`}>{vehicleScore}/100</span>
                    </summary>
                    <div className="grid grid-4" style={{ marginTop: 12 }}>
                      <div className="card stat"><span className="muted">Vehicle Health Score</span><strong>{vehicleScore}/100</strong><span className="badge">{healthyCount} healthy</span></div>
                      <div className="card stat"><span className="muted">Potential Revenue</span><strong>{money.format(potentialRevenue)}</strong><span className="badge warn">{dueSoonCount} due soon</span></div>
                      <div className="card stat"><span className="muted">Open Opportunities</span><strong>{money.format(openVehicleOpportunity)}</strong><span className="badge">Deferred</span></div>
                      <div className="card stat"><span className="muted">Due Services</span><strong>{overdueCount + dueCount}</strong><span className="badge danger">{overdueCount} overdue</span></div>
                    </div>
                    <details className="inline-details" style={{ marginTop: 12 }}>
                      <summary className="button ghost">View Details</summary>
                      <div className="list" style={{ marginTop: 12 }}>
                        <div className="mini-row"><span>Vehicle Summary</span><strong>{dueSoonCount} due soon · {overdueCount} overdue · {healthyCount} healthy · {money.format(potentialRevenue)} potential</strong></div>
                        {vehicleRows.length ? vehicleRows.map(({ item, prediction }) => (
                          <div className="mini-row" key={item.id}>
                            <span>
                              {item.name}
                              <small>Last {item.lastCompletedMileage.toLocaleString()} mi · current {prediction.currentMileage.toLocaleString()} mi · used {prediction.milesUsed.toLocaleString()} mi</small>
                            </span>
                            <span className={`badge ${prediction.statusTone}`}>{prediction.status} · {prediction.remainingLifePercentage}% life · due {prediction.dueMileage.toLocaleString()} mi</span>
                          </div>
                        )) : <p>No maintenance items yet.</p>}
                      </div>
                    </details>
                    <div className="card" style={{ marginTop: 12 }}>
                      <strong>Vehicle Health Factors</strong>
                      <p>
                        Overdue: {overdueCount}. Due: {dueCount}. Due soon: {dueSoonCount}. Healthy: {healthyCount}.
                        Score is the average remaining life across tracked services.
                      </p>
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
                      <label>Trim<input name="trim" defaultValue={vehicle.trim ?? ""} /></label>
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
              }) : <p>No vehicles yet. Add the first vehicle to start tracking service life.</p>}
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
              <label>Trim<input name="trim" /></label>
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
                <thead><tr><th>Vehicle</th><th>Service</th><th>Life</th><th>Mileage</th><th>Status</th><th>Value</th></tr></thead>
                <tbody>
                  {maintenanceRows.length ? maintenanceRows.slice(0, 10).map(({ vehicle, item, prediction }) => (
                    <tr key={item.id}>
                      <td>{vehicle.year} {vehicle.make} {vehicle.model}</td>
                      <td><strong>{item.name}</strong></td>
                      <td>
                        <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                        <small>{prediction.remainingLifePercentage}% remaining</small>
                      </td>
                      <td>
                        <small>Current {prediction.currentMileage.toLocaleString()} mi</small><br />
                        <small>Last {item.lastCompletedMileage.toLocaleString()} mi</small><br />
                        <small>Due {prediction.dueMileage.toLocaleString()} mi</small>
                      </td>
                      <td><span className={`badge ${prediction.statusTone}`}>{prediction.status}</span><br /><small>{dateLabel(prediction.dueDate)}</small></td>
                      <td>{money.format(item.averagePrice)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6}>No maintenance items yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Recent Service History</h2>
            <div className="list">
              {recentService.length ? recentService.map((record) => (
                <details className="card detail-card" key={record.id}>
                  <summary>
                  <div>
                    <strong>{record.summary}</strong>
                    <p>{dateLabel(record.serviceDate)} · {record.vehicle.year} {record.vehicle.make} {record.vehicle.model} · {record.mileage.toLocaleString()} mi · {record.notes ?? "No notes"}</p>
                    {record.nextRecommendedService ? <p>Next: {record.nextRecommendedService}{record.nextRecommendedMileage ? ` at ${record.nextRecommendedMileage.toLocaleString()} mi` : ""}</p> : null}
                  </div>
                  <span className="badge">{money.format(record.revenue)}</span>
                  </summary>
                  <form className="form" action={updateServiceRecordAction} style={{ marginTop: 12 }}>
                    <input type="hidden" name="serviceRecordId" value={record.id} />
                    <div className="form-row">
                      <label>Date<input name="serviceDate" type="date" defaultValue={yyyyMmDd(record.serviceDate)} /></label>
                      <label>Mileage<input name="mileage" type="number" min={0} defaultValue={record.mileage} required /></label>
                    </div>
                    <label>Services performed<input name="summary" defaultValue={record.summary} required /></label>
                    <label>Notes<textarea name="notes" defaultValue={record.notes ?? ""} /></label>
                    <div className="form-row">
                      <label>Invoice amount<input name="revenue" type="number" min={0} step="0.01" defaultValue={record.revenue} /></label>
                      <label>Technician ID<input name="technicianId" defaultValue={record.technicianId ?? ""} /></label>
                    </div>
                    <div className="form-row">
                      <label>Next service<input name="nextRecommendedService" defaultValue={record.nextRecommendedService ?? ""} /></label>
                      <label>Next mileage<input name="nextRecommendedMileage" type="number" min={0} defaultValue={record.nextRecommendedMileage ?? ""} /></label>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
                    <button className="button secondary" type="submit"><Save /> Save service record</button>
                  </form>
                  <form className="form danger-zone" action={deleteServiceRecordAction}>
                    <input type="hidden" name="serviceRecordId" value={record.id} />
                    <button className="button danger-button" type="submit"><Trash2 /> Delete service record</button>
                  </form>
                </details>
              )) : <p>No service records yet.</p>}
            </div>
          </div>

          <div className="panel">
            <h2>Create Service Record</h2>
            {customer.vehicles.length ? <form className="form" action={createServiceRecordAction}>
              <input type="hidden" name="returnTo" value={customerPath} />
              <label>Vehicle
                <select name="vehicleId" required>
                  {customer.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.year} {vehicle.make} {vehicle.model}</option>)}
                </select>
              </label>
              <label>Technician<input name="technicianId" placeholder="Optional technician ID from Team page" /></label>
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
              <div className="form-row">
                <label>Inventory barcode<input name="inventoryBarcode" placeholder="850001111001" /></label>
                <label>Qty used<input name="inventoryQuantityUsed" type="number" min={0} step="0.1" /></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower mileage</label>
              <button className="button" type="submit"><Wrench /> Add service record</button>
            </form> : <p>Add a vehicle before creating service records.</p>}
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
              <div className="mini-row"><span>Customer since</span><strong>{dateLabel(customer.createdAt)}</strong></div>
              <div className="mini-row"><span>Last visit</span><strong>{lastVisit ? dateLabel(lastVisit) : "None"}</strong></div>
              <div className="mini-row"><span>Next appointment</span><strong>{nextAppointment ? `${dateLabel(nextAppointment.scheduledAt)} · ${nextAppointment.serviceName}` : "None"}</strong></div>
            </div>
          </div>

          <div className="panel">
            <h2>Action Center</h2>
            <div className="grid grid-2">
              <a className="button secondary" href={phoneHref(customer.phone, "tel")}><Phone /> Call</a>
              <a className="button secondary" href={phoneHref(customer.phone, "sms")}><MessageSquareText /> Send SMS</a>
              <a className="button secondary" href={customer.email ? `mailto:${customer.email}` : "#"} aria-disabled={!customer.email}><Mail /> Send Email</a>
              <Link className="button" href="/app/calendar"><CalendarPlus /> Book Appointment</Link>
            </div>
          </div>

          <div className="panel">
            <h2>Driving Profile</h2>
            <div className="list">
              {customer.vehicles.length ? customer.vehicles.map((vehicle) => {
                const annualMiles = estimateAnnualMiles({ ...vehicle, mileageLogs: vehicle.mileageLogs });
                const dailyMiles = Math.round(annualMiles / 365);
                const accuracy = vehicle.mileageLogs.length >= 3 ? "High" : vehicle.mileageLogs.length >= 2 ? "Medium" : "Default";
                return (
                  <div className="card" key={vehicle.id}>
                    <strong>{vehicle.year} {vehicle.make} {vehicle.model}</strong>
                    <p>{annualMiles.toLocaleString()} miles/year · {dailyMiles.toLocaleString()} miles/day · {accuracy} accuracy</p>
                    <p>{vehicle.mileageLogs.length} mileage readings · last reading {vehicle.mileageLogs[0]?.mileage.toLocaleString() ?? vehicle.currentMileage.toLocaleString()} mi</p>
                    <div className="mini-row"><span>Mileage history</span><strong>{vehicle.mileageLogs.slice(0, 4).map((log) => log.mileage.toLocaleString()).join(" / ") || "None"}</strong></div>
                  </div>
                );
              }) : <p>No driving profile yet.</p>}
            </div>
          </div>

          <div className="panel">
            <h2>Customer Score</h2>
            <div className="list">
              <div className="mini-row"><span>Lifetime spend</span><strong>+{lifetimeSpendFactor}/25</strong></div>
              <div className="mini-row"><span>Appointment attendance</span><strong>+{appointmentAttendanceFactor}/20</strong></div>
              <div className="mini-row"><span>Reminder response</span><strong>+{reminderResponseFactor}/18</strong></div>
              <div className="mini-row"><span>Service frequency</span><strong>+{serviceFrequencyFactor}/29</strong></div>
              <div className="mini-row"><span>Vehicle count</span><strong>{customer.vehicles.length}</strong></div>
            </div>
          </div>

          <div className="panel">
            <h2>AI Service Advisor</h2>
            <p>Rule-based recommendations by service life.</p>
            <div className="list">
              <div className="card"><strong>High Priority</strong><p>{highPriority.map((row) => row.item.name).join(", ") || "No high-priority work"}</p></div>
              <div className="card"><strong>Medium Priority</strong><p>{mediumPriority.map((row) => row.item.name).join(", ") || "No medium-priority work"}</p></div>
              <div className="card"><strong>Low Priority</strong><p>{lowPriority.map((row) => row.item.name).join(", ") || "No low-priority work"}</p></div>
              <div className="card row"><strong>Potential Revenue</strong><span className="badge warn">{money.format([...highPriority, ...mediumPriority, ...lowPriority].reduce((sum, row) => sum + row.item.averagePrice, 0))}</span></div>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
