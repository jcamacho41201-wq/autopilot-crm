import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, CheckCircle2, Gauge, MessageSquareText, Plus, Save, Trash2, Wrench } from "lucide-react";
import {
  addMileageAction,
  applyRecommendedServicesAction,
  applyServicePackageAction,
  createAppointmentAction,
  createMaintenanceItemAction,
  createServiceRecordAction,
  deleteMileageLogAction,
  deleteMaintenanceItemAction,
  deleteVehicleAction,
  flagMileageCorrectionAction,
  sendMockReminderAction,
  updateMileageLogAction,
  updateMaintenanceItemAction,
  updateVehicleAction
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, dateTimeInputValue, money, number as numberFormat, yyyyMmDd } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { estimateAnnualMiles, maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nextAppointmentTime() {
  const date = new Date(Date.now() + 86400000);
  date.setHours(9, 0, 0, 0);
  return date;
}

function predictionAccuracy(logs: { mileage: number; loggedAt: Date; source: string }[]) {
  const cleanLogs = logs.filter((log) => !log.source.toLowerCase().includes("correction"));
  if (cleanLogs.length < 2) return 45;
  const first = cleanLogs[cleanLogs.length - 1];
  const last = cleanLogs[0];
  const spanDays = Math.max(1, (last.loggedAt.getTime() - first.loggedAt.getTime()) / 86400000);
  return Math.round(clamp(52 + cleanLogs.length * 8 + Math.min(20, spanDays / 18), 55, 95));
}

function MileageChart({ logs }: { logs: { mileage: number; loggedAt: Date }[] }) {
  const sorted = [...logs].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());
  if (!sorted.length) {
    return <div className="chart-empty">No mileage readings yet.</div>;
  }
  const width = 760;
  const height = 260;
  const pad = 34;
  const minMileage = Math.min(...sorted.map((log) => log.mileage));
  const maxMileage = Math.max(...sorted.map((log) => log.mileage));
  const firstTime = sorted[0].loggedAt.getTime();
  const lastTime = sorted[sorted.length - 1].loggedAt.getTime();
  const timeRange = Math.max(1, lastTime - firstTime);
  const mileageRange = Math.max(1, maxMileage - minMileage);
  const point = (log: { mileage: number; loggedAt: Date }) => {
    const x = pad + ((log.loggedAt.getTime() - firstTime) / timeRange) * (width - pad * 2);
    const y = height - pad - ((log.mileage - minMileage) / mileageRange) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const points = sorted.map(point).join(" ");
  const firstPoint = point(sorted[0]);
  const lastPoint = point(sorted[sorted.length - 1]);

  return (
    <svg className="mileage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Mileage over time">
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} />
      <polyline points={points} />
      <line className="trend" x1={firstPoint.split(",")[0]} y1={firstPoint.split(",")[1]} x2={lastPoint.split(",")[0]} y2={lastPoint.split(",")[1]} />
      {sorted.map((log) => {
        const [cx, cy] = point(log).split(",");
        return <circle key={`${log.loggedAt.toISOString()}-${log.mileage}`} cx={cx} cy={cy} r="5" />;
      })}
      <text x={pad} y={height - 8}>{dateLabel(sorted[0].loggedAt)}</text>
      <text x={width - pad - 60} y={height - 8}>{dateLabel(sorted[sorted.length - 1].loggedAt)}</text>
      <text x={pad + 4} y={pad - 10}>{maxMileage.toLocaleString()} mi</text>
      <text x={pad + 4} y={height - pad - 8}>{minMileage.toLocaleString()} mi</text>
    </svg>
  );
}

export default async function VehicleDashboardPage({
  params,
  searchParams
}: {
  params: { customerId: string; vehicleId: string };
  searchParams: { error?: string };
}) {
  const user = await requireUser();
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: params.vehicleId, customerId: params.customerId, customer: { shopId: user.shopId } },
    include: {
      customer: true,
      mileageLogs: { orderBy: { loggedAt: "desc" } },
      maintenanceItems: { include: { service: true } },
      serviceRecords: { orderBy: { serviceDate: "desc" }, take: 12 },
      appointments: { orderBy: { scheduledAt: "asc" }, take: 12 },
      opportunities: { where: { status: "OPEN" } }
    }
  });
  if (!vehicle) notFound();
  const [libraryServices, servicePackages] = await Promise.all([
    prisma.service.findMany({
      where: { shopId: user.shopId, status: "ACTIVE" },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    }),
    prisma.servicePackage.findMany({
      where: { shopId: user.shopId, status: "ACTIVE" },
      include: { items: { include: { service: true } } },
      orderBy: { name: "asc" }
    })
  ]);

  const annualMiles = estimateAnnualMiles({ ...vehicle, mileageLogs: vehicle.mileageLogs });
  const averageDailyMileage = Math.round(annualMiles / 365);
  const accuracy = predictionAccuracy(vehicle.mileageLogs);
  const rows = vehicle.maintenanceItems
    .map((item) => {
      const itemWithVehicle = {
        ...item,
        vehicle: {
          ...vehicle,
          customer: vehicle.customer,
          mileageLogs: vehicle.mileageLogs
        }
      } as MaintenanceWithVehicle;
      return { item, prediction: maintenancePrediction(itemWithVehicle) };
    })
    .sort((a, b) => a.prediction.remainingLifePercentage - b.prediction.remainingLifePercentage);
  const healthScore = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / rows.length)
    : 100;
  const opportunityRows = rows.filter((row) => row.item.serviceId && row.prediction.status !== "Healthy");
  const unmappedRows = rows.filter((row) => !row.item.serviceId);
  const potentialRevenue = opportunityRows.reduce((sum, row) => sum + row.item.averagePrice, 0);
  const highestPriority = opportunityRows[0] ?? rows[0];
  const lastVisit = vehicle.serviceRecords[0]?.serviceDate;
  const nextAppointment = vehicle.appointments
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= new Date())
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  const lastReading = vehicle.mileageLogs[0];
  const vehiclePath = `/app/customers/${vehicle.customerId}/vehicles/${vehicle.id}`;
  const assignedServiceIds = new Set(vehicle.maintenanceItems.map((item) => item.serviceId).filter(Boolean));
  const unassignedServices = libraryServices.filter((service) => !assignedServiceIds.has(service.id));
  const recommendedNames = new Set([
    "Oil change",
    "Tire rotation",
    "Brake inspection",
    "Coolant flush",
    "Transmission service",
    "Air filter",
    "Cabin filter",
    "Battery inspection",
    ...(vehicle.make.toLowerCase().includes("jeep") || vehicle.vehicleType?.toLowerCase().includes("truck")
      ? ["Differential Service", "Transfer Case Service"]
      : [])
  ]);
  const recommendedServices = unassignedServices.filter((service) => recommendedNames.has(service.name));

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Vehicle dashboard</p>
          <h1>{vehicle.year} {vehicle.make} {vehicle.model}</h1>
          <p>{vehicle.customer.name} · {vehicle.vehicleType ?? "Vehicle"} · {vehicle.currentMileage.toLocaleString()} mi</p>
        </div>
        <Link className="button secondary" href={`/app/customers/${vehicle.customerId}`}><ArrowLeft /> Customer</Link>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Current Mileage</span><strong>{vehicle.currentMileage.toLocaleString()}</strong><span className="badge">Vehicle profile</span></div>
        <div className="card stat"><span className="muted">Vehicle Health</span><strong>{healthScore}/100</strong><span className={`badge ${healthScore < 35 ? "danger" : healthScore < 60 ? "warn" : "ok"}`}>Predicted</span></div>
        <div className="card stat"><span className="muted">Potential Revenue</span><strong>{money.format(potentialRevenue)}</strong><span className="badge warn">{opportunityRows.length} open</span></div>
        <div className="card stat"><span className="muted">Needs Template Mapping</span><strong>{unmappedRows.length}</strong><span className="badge">Setup</span></div>
        <div className="card stat"><span className="muted">Next Appointment</span><strong>{nextAppointment ? dateLabel(nextAppointment.scheduledAt) : "None"}</strong><span className="badge">Calendar</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="grid">
          <div className="panel" id="mileage-management">
            <h2>Vehicle Summary</h2>
            <div className="grid grid-3">
              <div className="card"><strong>Vehicle</strong><p>{vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ` ${vehicle.trim}` : ""}</p></div>
              <div className="card"><strong>VIN</strong><p>{vehicle.vin ?? "Not set"}</p></div>
              <div className="card"><strong>Plate</strong><p>{vehicle.licensePlate ?? "Not set"}</p></div>
              <div className="card"><strong>Last Visit</strong><p>{lastVisit ? dateLabel(lastVisit) : "None"}</p></div>
              <div className="card"><strong>Open Opportunity</strong><p>{money.format(potentialRevenue)}</p></div>
              <div className="card"><strong>Vehicle Notes</strong><p>{vehicle.notes || "No notes yet."}</p></div>
            </div>
          </div>

          <div className="panel">
            <div className="row">
              <h2>Mileage Management</h2>
              <details className="inline-details modal-details">
                <summary className="button"><Plus /> Add Mileage Reading</summary>
                <div className="modal-panel">
                  <form className="form" action={addMileageAction}>
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <input type="hidden" name="returnTo" value={vehiclePath} />
                    <label>Mileage<input name="mileage" type="number" min={0} required /></label>
                    <label>Date<input name="loggedAt" type="date" defaultValue={yyyyMmDd(new Date())} /></label>
                    <label>Source
                      <select name="source" defaultValue="Service Visit">
                        <option>Service Visit</option>
                        <option>Customer Update</option>
                        <option>Manual Entry</option>
                        <option>Odometer Inspection</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm Lower Mileage</label>
                    <button className="button" type="submit"><Gauge /> Save reading</button>
                  </form>
                </div>
              </details>
            </div>
            <div className="grid grid-4" style={{ marginTop: 12 }}>
              <div className="card stat"><span className="muted">Current Mileage</span><strong>{vehicle.currentMileage.toLocaleString()}</strong></div>
              <div className="card stat"><span className="muted">Last Reading</span><strong>{lastReading ? lastReading.mileage.toLocaleString() : "None"}</strong></div>
              <div className="card stat"><span className="muted">Estimated Annual Mileage</span><strong>{annualMiles.toLocaleString()}</strong></div>
              <div className="card stat"><span className="muted">Average Daily Mileage</span><strong>{averageDailyMileage.toLocaleString()}</strong></div>
            </div>
            <div className="grid grid-3" style={{ marginTop: 12 }}>
              <div className="card"><strong>Prediction Accuracy</strong><p>{accuracy}%</p></div>
              <div className="card"><strong>Readings</strong><p>{vehicle.mileageLogs.length}</p></div>
              <div className="card"><strong>Last Reading Date</strong><p>{lastReading ? dateLabel(lastReading.loggedAt) : "None"}</p></div>
            </div>
          </div>

          <div className="panel">
            <h2>Mileage Trend</h2>
            <MileageChart logs={vehicle.mileageLogs} />
          </div>

          <div className="panel">
            <h2>Mileage History</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Mileage</th><th>Source</th><th>Actions</th></tr></thead>
                <tbody>
                  {vehicle.mileageLogs.length ? vehicle.mileageLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{dateLabel(log.loggedAt)}</td>
                      <td>{log.mileage.toLocaleString()}</td>
                      <td><span className={log.source.toLowerCase().includes("correction") ? "badge warn" : "badge"}>{log.source}</span></td>
                      <td>
                        <details className="inline-details">
                          <summary className="button ghost">Edit Reading</summary>
                          <form className="form compact-form" action={updateMileageLogAction}>
                            <input type="hidden" name="mileageLogId" value={log.id} />
                            <input type="hidden" name="returnTo" value={vehiclePath} />
                            <label>Date<input name="loggedAt" type="date" defaultValue={yyyyMmDd(log.loggedAt)} /></label>
                            <label>Mileage<input name="mileage" type="number" min={0} defaultValue={log.mileage} required /></label>
                            <label>Source
                              <select name="source" defaultValue={log.source.replace(/^Correction: /, "")}>
                                <option>Service Visit</option>
                                <option>Customer Update</option>
                                <option>Manual Entry</option>
                                <option>Odometer Inspection</option>
                              </select>
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" defaultChecked={log.source.toLowerCase().includes("correction")} /> Confirm Lower Mileage</label>
                            <button className="button secondary" type="submit"><Save /> Save reading</button>
                          </form>
                        </details>
                        <div className="queue-actions">
                          <form action={flagMileageCorrectionAction}>
                            <input type="hidden" name="mileageLogId" value={log.id} />
                            <button className="button secondary" type="submit">Flag Correction</button>
                          </form>
                          <form action={deleteMileageLogAction}>
                            <input type="hidden" name="mileageLogId" value={log.id} />
                            <button className="button danger-button" type="submit"><Trash2 /> Delete</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={4}>No mileage readings yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" id="maintenance-schedule">
            <div className="row">
              <h2>Maintenance Schedule</h2>
              <details className="inline-details modal-details">
                <summary className="button"><Plus /> Add Maintenance Item</summary>
                <div className="modal-panel">
                  {unassignedServices.length ? <form className="form" action={createMaintenanceItemAction}>
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <input type="hidden" name="returnTo" value={vehiclePath} />
                    <label>Select Service
                      <select name="serviceId" required>
                        {unassignedServices.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name} · {service.category} · {numberFormat.format(service.defaultMileageInterval)} mi / {service.defaultTimeIntervalMonths} mo · {money.format(service.averagePrice)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-row">
                      <label>Last completed date<input name="lastCompletedDate" type="date" defaultValue={yyyyMmDd(new Date())} /></label>
                      <label>Last completed mileage<input name="lastCompletedMileage" type="number" min={0} defaultValue={vehicle.currentMileage} /></label>
                    </div>
                    <p>Intervals, price, and reminder threshold come from the Service Library. Add overrides only when this vehicle needs a custom schedule.</p>
                    <div className="form-row">
                      <label>Override mileage interval<input name="mileageInterval" type="number" min={1} placeholder="Use library default" /></label>
                      <label>Override time interval<input name="timeIntervalMonths" type="number" min={1} placeholder="Use library default" /></label>
                    </div>
                    <div className="form-row">
                      <label>Override price<input name="averagePrice" type="number" min={0} step="0.01" placeholder="Use library default" /></label>
                      <label>Override reminder %<input name="reminderThresholdPercentage" type="number" min={0} max={100} placeholder="Use library default" /></label>
                    </div>
                    <label>Status
                      <select name="status" defaultValue="ACTIVE">
                        <option>ACTIVE</option>
                        <option>WATCH</option>
                        <option>DUE</option>
                        <option>DEFERRED</option>
                        <option>PAUSED</option>
                      </select>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="remindersEnabled" defaultChecked /> Reminders enabled</label>
                    <button className="button" type="submit"><Wrench /> Add service</button>
                  </form> : (
                    <div className="empty-state">
                      <p>All active library services are already assigned to this vehicle.</p>
                      <Link className="button secondary" href="/app/settings/service-library">Open Service Library</Link>
                    </div>
                  )}
                </div>
              </details>
            </div>
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <details className="card detail-card">
                <summary>
                  <div>
                    <strong>Apply Service Package</strong>
                    <p>Add a predefined set of library services to this vehicle.</p>
                  </div>
                  <span className="badge">{servicePackages.length} packages</span>
                </summary>
                {servicePackages.length ? (
                  <form className="form" action={applyServicePackageAction} style={{ marginTop: 12 }}>
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <input type="hidden" name="returnTo" value={vehiclePath} />
                    <label>Package
                      <select name="packageId">
                        {servicePackages.map((pkg) => (
                          <option key={pkg.id} value={pkg.id}>{pkg.name} · {pkg.items.length} services</option>
                        ))}
                      </select>
                    </label>
                    <button className="button secondary" type="submit"><Plus /> Apply package</button>
                  </form>
                ) : <p>No service packages yet. Create packages in Service Library.</p>}
              </details>
              <details className="card detail-card">
                <summary>
                  <div>
                    <strong>Apply Recommended Services</strong>
                    <p>Suggested services based on this vehicle profile.</p>
                  </div>
                  <span className="badge">{recommendedServices.length} suggested</span>
                </summary>
                {recommendedServices.length ? (
                  <form className="form" action={applyRecommendedServicesAction} style={{ marginTop: 12 }}>
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <input type="hidden" name="returnTo" value={vehiclePath} />
                    <div className="checkbox-grid">
                      {recommendedServices.map((service) => (
                        <label key={service.id} className="checkbox-row">
                          <input type="checkbox" name="serviceIds" value={service.id} defaultChecked />
                          {service.name}
                        </label>
                      ))}
                    </div>
                    <button className="button secondary" type="submit"><Plus /> Apply selected</button>
                  </form>
                ) : <p>No recommended unassigned services are available for this vehicle.</p>}
              </details>
            </div>
            {unmappedRows.length ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="row">
                  <strong>Service Template Mapping Needed</strong>
                  <span className="badge warn">{unmappedRows.length} unmapped</span>
                </div>
                <p>These items stay on the vehicle profile, but they are not counted as revenue opportunities until they are recreated from the Service Library.</p>
                <Link className="button secondary" href="/app/settings/service-library">Open Service Library</Link>
              </div>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Service Template</th><th>Status</th><th>Due Date</th><th>Due Mileage</th><th>Revenue</th><th>Remaining Life</th><th>Manage</th></tr></thead>
                <tbody>
                  {rows.length ? rows.map(({ item, prediction }) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <br />
                        <span className="muted">
                          {item.service
                            ? item.mileageInterval !== item.service.defaultMileageInterval ||
                              item.timeIntervalMonths !== item.service.defaultTimeIntervalMonths ||
                              item.averagePrice !== item.service.averagePrice ||
                              item.reminderThresholdPercentage !== item.service.defaultReminderThreshold
                              ? "Using Custom Interval"
                              : `Library: ${item.service.category}`
                            : "Needs Service Template"}
                        </span>
                      </td>
                      <td><span className={`badge ${prediction.statusTone}`}>{prediction.status}</span></td>
                      <td>{dateLabel(prediction.dueDate)}</td>
                      <td>{prediction.dueMileage.toLocaleString()} mi</td>
                      <td>{money.format(item.averagePrice)}</td>
                      <td>
                        <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                        <small>{prediction.remainingLifePercentage}% remaining</small>
                      </td>
                      <td>
                        <details className="inline-details">
                          <summary className="button ghost">Edit</summary>
                          <form className="form compact-form" action={updateMaintenanceItemAction}>
                            <input type="hidden" name="maintenanceId" value={item.id} />
                            <input type="hidden" name="returnTo" value={vehiclePath} />
                            <input type="hidden" name="name" value={item.name} />
                            <div className="card">
                              <strong>{item.name}</strong>
                              <p>{item.service ? `Defaults from Service Library: ${item.service.category}` : "Legacy custom service"}</p>
                            </div>
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
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm lower due mileage</label>
                            <label>Notes<textarea name="customNotes" defaultValue={item.customNotes ?? ""} /></label>
                            <button className="button secondary" type="submit"><Save /> Save item</button>
                          </form>
                        </details>
                        <form className="form danger-zone" action={deleteMaintenanceItemAction}>
                          <input type="hidden" name="maintenanceId" value={item.id} />
                          <input type="hidden" name="returnTo" value={vehiclePath} />
                          <button className="button danger-button" type="submit"><Trash2 /> Delete</button>
                        </form>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={7}>No maintenance items yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Service History</h2>
            <div className="list">
              {vehicle.serviceRecords.length ? vehicle.serviceRecords.map((record) => (
                <div className="card" key={record.id}>
                  <div className="row"><strong>{record.summary}</strong><span className="badge">{money.format(record.revenue)}</span></div>
                  <p>{dateLabel(record.serviceDate)} · {record.mileage.toLocaleString()} mi · {record.notes ?? "No notes"}</p>
                </div>
              )) : <p>No service records yet.</p>}
            </div>
          </div>
        </div>

        <aside className="grid">
          <div className="panel">
            <h2>Quick Actions</h2>
            <div className="grid">
              <a className="button" href="#mileage-management"><Gauge /> Add Mileage Reading</a>
              <details className="inline-details">
                <summary className="button secondary"><Wrench /> Create Service Record</summary>
                <form className="form" action={createServiceRecordAction}>
                  <input type="hidden" name="returnTo" value={vehiclePath} />
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                  <label>Date<input name="serviceDate" type="date" defaultValue={yyyyMmDd(new Date())} required /></label>
                  <label>Mileage<input name="mileage" type="number" min={0} defaultValue={vehicle.currentMileage} required /></label>
                  <label>Service performed<input name="summary" required placeholder="Oil change and tire rotation" /></label>
                  <label>Notes<textarea name="notes" /></label>
                  <label>Price<input name="revenue" type="number" min={0} step="0.01" defaultValue={highestPriority?.item.averagePrice ?? 0} /></label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm Lower Mileage</label>
                  <button className="button secondary" type="submit"><CheckCircle2 /> Create record</button>
                </form>
              </details>
              <details className="inline-details appointment-booking-details">
                <summary className="button secondary"><CalendarPlus /> Book Appointment</summary>
                <form className="form compact-form" action={createAppointmentAction}>
                  <input type="hidden" name="customerId" value={vehicle.customerId} />
                  <input type="hidden" name="vehicleId" value={vehicle.id} />
                  <input type="hidden" name="serviceName" value={highestPriority?.item.name ?? "Vehicle service"} />
                  <input type="hidden" name="estimatedRevenue" value={potentialRevenue || highestPriority?.item.averagePrice || 0} />
                  <input type="hidden" name="estimatedDurationMinutes" value={45} />
                  <div className="card">
                    <strong>{opportunityRows.length || 1} service{opportunityRows.length === 1 ? "" : "s"}</strong>
                    <p>{money.format(potentialRevenue || highestPriority?.item.averagePrice || 0)} total opportunity.</p>
                  </div>
                  {opportunityRows.length ? (
                    <div className="checkbox-grid">
                      {opportunityRows.map(({ item }) => (
                        <label className="checkbox-row" key={item.id}>
                          <input type="checkbox" name="maintenanceIds" value={item.id} defaultChecked />
                          {item.service?.name ?? item.name} · {money.format(item.averagePrice)} · 45 min
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <label>When<input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInputValue(nextAppointmentTime())} /></label>
                  <label>Notes<textarea name="notes" defaultValue={`Booked from vehicle dashboard for ${vehicle.year} ${vehicle.make} ${vehicle.model}.`} /></label>
                  <button className="button" type="submit"><CalendarPlus /> Book vehicle visit</button>
                </form>
              </details>
              {highestPriority ? (
                <form action={sendMockReminderAction}>
                  <input type="hidden" name="maintenanceId" value={highestPriority.item.id} />
                  <button className="button secondary" type="submit"><MessageSquareText /> Send Reminder</button>
                </form>
              ) : <button className="button secondary" type="button" disabled><MessageSquareText /> Send Reminder</button>}
              <a className="button secondary" href="#maintenance-schedule">View Maintenance Schedule</a>
            </div>
          </div>

          <form className="panel form" action={updateVehicleAction}>
            <h2>Edit Vehicle</h2>
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <input type="hidden" name="returnTo" value={vehiclePath} />
            <div className="form-row">
              <label>Year<input name="year" type="number" defaultValue={vehicle.year} required /></label>
              <label>Type<input name="vehicleType" defaultValue={vehicle.vehicleType ?? ""} /></label>
            </div>
            <div className="form-row">
              <label>Make<input name="make" defaultValue={vehicle.make} required /></label>
              <label>Model<input name="model" defaultValue={vehicle.model} required /></label>
            </div>
            <label>Trim<input name="trim" defaultValue={vehicle.trim ?? ""} /></label>
            <div className="form-row">
              <label>VIN<input name="vin" defaultValue={vehicle.vin ?? ""} /></label>
              <label>Plate<input name="licensePlate" defaultValue={vehicle.licensePlate ?? ""} /></label>
            </div>
            <label>Vehicle notes<textarea name="notes" defaultValue={vehicle.notes ?? ""} /></label>
            <button className="button secondary" type="submit"><Save /> Save vehicle</button>
          </form>

          <form className="panel form danger-zone" action={deleteVehicleAction}>
            <h2>Delete Vehicle</h2>
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <input type="hidden" name="returnTo" value={`/app/customers/${vehicle.customerId}`} />
            <p>Deleting this vehicle also deletes its mileage readings, service history, maintenance items, appointments, and opportunities.</p>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmDelete" /> I understand and want to delete this vehicle</label>
            <button className="button danger-button" type="submit"><Trash2 /> Delete vehicle</button>
          </form>

          <div className="panel">
            <h2>Driving Profile</h2>
            <div className="list">
              <div className="mini-row"><span>Estimated Annual Mileage</span><strong>{annualMiles.toLocaleString()}</strong></div>
              <div className="mini-row"><span>Average Daily Mileage</span><strong>{averageDailyMileage.toLocaleString()}</strong></div>
              <div className="mini-row"><span>Prediction Accuracy</span><strong>{accuracy}%</strong></div>
              <div className="mini-row"><span>Readings</span><strong>{vehicle.mileageLogs.length}</strong></div>
              <div className="mini-row"><span>Last Reading</span><strong>{lastReading ? dateLabel(lastReading.loggedAt) : "None"}</strong></div>
              <div className="mini-row"><span>Mileage Trend</span><strong>{vehicle.mileageLogs.length >= 2 ? "Active" : "Learning"}</strong></div>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
