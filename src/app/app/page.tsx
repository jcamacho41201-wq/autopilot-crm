import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  DollarSign,
  PackageSearch,
  Send,
  Wrench
} from "lucide-react";
import { createAppointmentAction, sendMockReminderAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import {
  getCapacityForecast,
  getLowInventoryAlerts,
  getMaintenanceRows,
  getMaintenanceStatusBreakdown,
  getRetentionSnapshot,
  getRevenueByServiceType,
  getRevenueForecast,
  getRevenuePipeline,
  getTodayShopSnapshot,
  getTopOpportunities,
  getVehiclesRequiringAttention,
  type VehicleAttentionCard
} from "@/lib/dashboard";
import { dateLabel, dateTimeInputValue, money, number } from "@/lib/format";
import { prisma } from "@/lib/prisma";

function nextAppointmentTime() {
  const date = new Date(Date.now() + 86400000);
  date.setHours(9, 0, 0, 0);
  return date;
}

function priorityMeta(priority: VehicleAttentionCard["priority"]) {
  if (priority === "red") return { Icon: AlertCircle, badge: "danger", label: "Overdue" };
  if (priority === "yellow") return { Icon: AlertTriangle, badge: "warn", label: "Due soon" };
  if (priority === "green") return { Icon: CheckCircle2, badge: "ok", label: "Healthy" };
  return { Icon: Clock, badge: "", label: "No data" };
}

function dueLabel(card: VehicleAttentionCard) {
  if (card.overdueCount) return "Overdue";
  const dueDate = card.attentionRows[0]?.prediction.dueDate;
  return dueDate ? dateLabel(dueDate) : "Healthy";
}

function vehicleName(card: VehicleAttentionCard) {
  return `${card.vehicle.year} ${card.vehicle.make} ${card.vehicle.model}`;
}

function AppointmentForm({ card, label = "Book Appointment" }: { card: VehicleAttentionCard; label?: string }) {
  const service = card.attentionRows[0]?.item.name ?? "Maintenance service";
  const revenue = card.attentionRows[0]?.item.averagePrice ?? card.opportunityValue;
  return (
    <form action={createAppointmentAction}>
      <input type="hidden" name="customerId" value={card.customer.id} />
      <input type="hidden" name="vehicleId" value={card.vehicle.id} />
      <input type="hidden" name="scheduledAt" value={dateTimeInputValue(nextAppointmentTime())} />
      <input type="hidden" name="durationMinutes" value={60} />
      <input type="hidden" name="serviceName" value={service} />
      <input type="hidden" name="estimatedRevenue" value={revenue} />
      <input type="hidden" name="notes" value={`Booked from dashboard opportunity for ${service}.`} />
      <button className="button secondary" type="submit"><CalendarPlus /> {label}</button>
    </form>
  );
}

function ReminderForm({ card, label = "Send Reminder" }: { card: VehicleAttentionCard; label?: string }) {
  if (!card.primaryMaintenanceId) {
    return <Link className="button secondary" href="/app/reminders"><Send /> {label}</Link>;
  }
  return (
    <form action={sendMockReminderAction}>
      <input type="hidden" name="maintenanceId" value={card.primaryMaintenanceId} />
      <button className="button secondary" type="submit"><Send /> {label}</button>
    </form>
  );
}

function RevenueForecastChart({ data }: { data: ReturnType<typeof getRevenueForecast> }) {
  const hasData = data.some((point) => point.booked > 0 || point.predicted > 0);
  if (!hasData) {
    return <div className="chart-empty">No forecast data yet. Add appointments and maintenance intervals to generate a revenue forecast.</div>;
  }

  const width = 760;
  const height = 280;
  const pad = 36;
  const maxRevenue = Math.max(1, ...data.map((point) => point.total));
  const x = (index: number) => pad + (index / Math.max(1, data.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / maxRevenue) * (height - pad * 2);
  const points = (key: "booked" | "predicted" | "total") => data.map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");

  return (
    <div className="chart-card">
      <svg className="revenue-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue forecast for the next 90 days">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} />
        <polyline className="total" points={points("total")} />
        <polyline className="booked" points={points("booked")} />
        <polyline className="predicted" points={points("predicted")} />
        <text x={pad} y={pad - 10}>{money.format(maxRevenue)}</text>
        <text x={pad} y={height - 8}>{dateLabel(data[0].start)}</text>
        <text x={width - pad - 46} y={height - 8}>{dateLabel(data[data.length - 1].start)}</text>
      </svg>
      <div className="chart-legend">
        <span><i className="legend-total" /> Total opportunity</span>
        <span><i className="legend-booked" /> Booked revenue</span>
        <span><i className="legend-predicted" /> Predicted maintenance</span>
      </div>
    </div>
  );
}

function BarRow({ label, value, max, tone = "" }: { label: string; value: number; max: number; tone?: string }) {
  const width = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <div className="mini-row"><span>{label}</span><strong>{number.format(value)}</strong></div>
      <div className={`bar-track ${tone}`}><span style={{ width: `${width}%` }} /></div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [appointments, maintenance, opportunities, inventory, customers] = await Promise.all([
    prisma.appointment.findMany({
      where: { shopId: user.shopId },
      orderBy: { scheduledAt: "asc" },
      include: { customer: true, vehicle: true, technician: true }
    }),
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: {
        vehicle: { include: { customer: true, mileageLogs: true } },
        reminders: { orderBy: { sentAt: "desc" }, take: 1 }
      }
    }),
    prisma.deferredOpportunity.findMany({
      where: { shopId: user.shopId, status: "OPEN" },
      include: { vehicle: { include: { customer: true } } },
      orderBy: { followUpDate: "asc" }
    }),
    prisma.inventoryItem.findMany({
      where: { shopId: user.shopId },
      include: { scanLogs: true },
      orderBy: { quantityOnHand: "asc" }
    }),
    prisma.customer.findMany({
      where: { shopId: user.shopId },
      include: {
        serviceRecords: { orderBy: { serviceDate: "desc" }, take: 1 },
        appointments: { orderBy: { scheduledAt: "desc" }, take: 1 }
      }
    })
  ]);

  const asOf = new Date();
  const maintenanceRows = getMaintenanceRows(maintenance, asOf);
  const vehicleCards = getVehiclesRequiringAttention(maintenanceRows, appointments, asOf);
  const snapshot = getTodayShopSnapshot(appointments, vehicleCards, asOf);
  const pipeline = getRevenuePipeline(appointments, maintenanceRows, opportunities, asOf);
  const revenueForecast = getRevenueForecast(appointments, maintenanceRows, asOf);
  const maintenanceStatus = getMaintenanceStatusBreakdown(maintenanceRows);
  const revenueByService = getRevenueByServiceType(maintenanceRows);
  const capacityForecast = getCapacityForecast(appointments, asOf);
  const topOpportunities = getTopOpportunities(vehicleCards);
  const inventoryAlerts = getLowInventoryAlerts(inventory);
  const retention = getRetentionSnapshot(customers, vehicleCards, asOf);
  const upcoming = Array.from(
    new Map(
      appointments
        .filter((appointment) => appointment.scheduledAt >= asOf && appointment.status === "BOOKED")
        .map((appointment) => [appointment.id, appointment])
    ).values()
  ).slice(0, 6);
  const maxStatus = Math.max(maintenanceStatus.healthy, maintenanceStatus.dueSoon, maintenanceStatus.overdue, 1);
  const maxServiceRevenue = Math.max(1, ...revenueByService.map((item) => item.revenue));

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Maintiva Dashboard</p>
          <h1>{user.shop.name}</h1>
          <p>Predict demand, book the calendar, and turn future maintenance into scheduled revenue.</p>
        </div>
        <div className="row">
          <Link className="button secondary" href={user.shop.bookingLink || `/booking/${user.shop.slug}`}><CalendarPlus /> Booking page</Link>
          <Link className="button" href="/app/reminders"><Send /> Send reminders</Link>
        </div>
      </header>

      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Cars Scheduled Today</span><strong>{snapshot.carsScheduledToday}</strong><span className="badge">{money.format(snapshot.bookedRevenueToday)} booked today</span></div>
        <div className="card stat"><span className="muted">Open Bays / Capacity</span><strong>{snapshot.openMinutesToday} min open</strong><span className="badge">{snapshot.utilizationToday}% utilized today</span></div>
        <div className="card stat"><span className="muted">Ready To Remind</span><strong>{snapshot.readyToRemind}</strong><span className="badge warn">customers</span></div>
        <div className="card stat"><span className="muted">Calendar Utilization</span><strong>{snapshot.calendarUtilization}%</strong><span className="badge">Next 7 days</span></div>
      </section>

      <section className="grid grid-5" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="muted">Booked Revenue</span><strong>{money.format(pipeline.bookedRevenue)}</strong><span className="badge">Calendar confirmed</span></div>
        <div className="card stat"><span className="muted">Predicted Revenue</span><strong>{money.format(pipeline.predictedRevenue)}</strong><span className="badge ok">Next 30 days</span></div>
        <div className="card stat"><span className="muted">Overdue Revenue</span><strong>{money.format(pipeline.overdueRevenue)}</strong><span className="badge danger">Needs action</span></div>
        <div className="card stat"><span className="muted">Total Opportunity</span><strong>{money.format(pipeline.totalOpportunity)}</strong><span className="badge warn">Open pipeline</span></div>
        <div className="card stat"><span className="muted">Deferred Opportunity</span><strong>{money.format(pipeline.deferredRevenue)}</strong><span className="badge">{opportunities.length} open</span></div>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <div className="row">
            <h2>Vehicles Requiring Attention</h2>
            <Link className="text-link" href="/app/maintenance">View all</Link>
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {vehicleCards.length ? vehicleCards.map((card) => {
              const { Icon, badge, label } = priorityMeta(card.priority);
              return (
                <details className="vehicle-queue-card dashboard-attention-card" key={card.vehicle.id}>
                  <summary>
                    <div className="dashboard-attention-main">
                      <span className={`badge ${badge}`}><Icon size={15} /> {label}</span>
                      <div>
                        <strong>{card.customer.name}</strong>
                        <p>{vehicleName(card)} · {number.format(card.vehicle.currentMileage)} mi</p>
                      </div>
                    </div>
                    <div className="queue-summary">
                      <span className="badge danger">{card.overdueCount} overdue</span>
                      <span className="badge warn">{card.dueCount + card.dueSoonCount} due soon</span>
                      <span className={`badge ${card.healthScore < 35 ? "danger" : card.healthScore < 60 ? "warn" : "ok"}`}>{card.healthScore}/100 health</span>
                      <span className="badge">{money.format(card.opportunityValue)}</span>
                    </div>
                  </summary>
                  <div className="queue-preview">
                    <span><strong>Next Due:</strong> {dueLabel(card)}</span>
                    <span><strong>Next Best Action:</strong> {card.nextBestAction}</span>
                    <div className="queue-actions">
                      <Link className="button secondary" href={`/app/customers/${card.customer.id}/vehicles/${card.vehicle.id}`}><Wrench /> Open Vehicle</Link>
                      <ReminderForm card={card} />
                      <AppointmentForm card={card} />
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Service</th><th>Status</th><th>Life Remaining</th><th>Due Mileage</th><th>Due Date</th><th>Estimated Revenue</th></tr></thead>
                      <tbody>
                        {card.attentionRows.map(({ item, prediction }) => (
                          <tr key={item.id}>
                            <td><strong>{item.name}</strong></td>
                            <td><span className={`badge ${prediction.statusTone}`}>{prediction.status}</span></td>
                            <td>
                              <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                              <small>{prediction.remainingLifePercentage}% remaining</small>
                            </td>
                            <td>{number.format(prediction.dueMileage)} mi</td>
                            <td>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</td>
                            <td>{money.format(item.averagePrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            }) : <p>No vehicles need attention right now. Add service intervals to begin predicting maintenance.</p>}
          </div>
        </div>

        <aside className="panel">
          <div className="row">
            <h2>Upcoming Appointments</h2>
            <Link className="text-link" href="/app/calendar">Open Calendar</Link>
          </div>
          <div className="list" style={{ marginTop: 12 }}>
            {upcoming.length ? upcoming.map((appointment) => (
              <div className="card" key={appointment.id}>
                <div className="row">
                  <strong>{dateLabel(appointment.scheduledAt)} · {appointment.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</strong>
                  <span className="badge">{money.format(appointment.estimatedRevenue)}</span>
                </div>
                <p>{appointment.customer?.name ?? "Unknown customer"} · {appointment.vehicle ? `${appointment.vehicle.year} ${appointment.vehicle.make} ${appointment.vehicle.model}` : "Unknown vehicle"}</p>
                <p>{appointment.serviceName} · {appointment.technician?.name ?? "Unassigned"} · {appointment.status}</p>
              </div>
            )) : (
              <div className="empty-state">
                <p>No upcoming appointments. Book an opportunity from the maintenance queue.</p>
                <Link className="button secondary" href="/app/calendar"><CalendarDays /> Open Calendar</Link>
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <h2>Revenue Forecast</h2>
          <RevenueForecastChart data={revenueForecast} />
        </div>
        <aside className="panel">
          <h2>Maintenance Status</h2>
          <div className="list" style={{ marginTop: 12 }}>
            <BarRow label="Healthy" value={maintenanceStatus.healthy} max={maxStatus} tone="ok" />
            <BarRow label="Due Soon" value={maintenanceStatus.dueSoon} max={maxStatus} tone="warn" />
            <BarRow label="Overdue" value={maintenanceStatus.overdue} max={maxStatus} tone="danger" />
          </div>
        </aside>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <h2>Revenue Opportunities By Service</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {revenueByService.length ? revenueByService.map((item) => (
              <div className="bar-row" key={item.service}>
                <div className="mini-row"><span>{item.service}</span><strong>{money.format(item.revenue)}</strong></div>
                <div className="bar-track"><span style={{ width: `${Math.max(8, Math.round((item.revenue / maxServiceRevenue) * 100))}%` }} /></div>
              </div>
            )) : <p>No open opportunities yet.</p>}
          </div>
        </div>
        <aside className="panel">
          <h2>Next 14 Days Capacity</h2>
          <div className="capacity-list">
            {capacityForecast.map((day) => (
              <div className="capacity-day" key={day.date.toISOString()}>
                <div className="mini-row"><span>{dateLabel(day.date)}</span><strong>{day.utilization}%</strong></div>
                <div className="bar-track"><span style={{ width: `${Math.min(100, day.utilization)}%` }} /></div>
                <p>{day.scheduledMinutes} min scheduled · {day.availableMinutes} min open</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <h2>Top Opportunities</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {topOpportunities.length ? topOpportunities.map((card) => (
              <div className="card" key={card.vehicle.id}>
                <div className="row">
                  <div>
                    <strong>{card.customer.name}</strong>
                    <p>{vehicleName(card)} · {card.overdueCount ? `${card.overdueCount} overdue services` : `${card.dueCount + card.dueSoonCount} due soon services`}</p>
                  </div>
                  <span className="badge warn">{money.format(card.opportunityValue)} opportunity</span>
                </div>
                <div className="queue-actions">
                  <ReminderForm card={card} />
                  <AppointmentForm card={card} />
                  <Link className="button secondary" href={`/app/customers/${card.customer.id}/vehicles/${card.vehicle.id}`}><Wrench /> Open Vehicle</Link>
                </div>
              </div>
            )) : <p>No open opportunities yet.</p>}
          </div>
        </div>
        <aside className="grid">
          <div className="panel">
            <h2>Low Inventory Alerts</h2>
            <div className="list" style={{ marginTop: 12 }}>
              {inventoryAlerts.length ? inventoryAlerts.map(({ item, runout }) => (
                <div className="card" key={item.id}>
                  <div className="row">
                    <strong>{item.name}</strong>
                    <span className="badge danger">{item.quantityOnHand} {item.unitType}</span>
                  </div>
                  <p>Threshold: {item.reorderThreshold} {item.unitType} · Runout: {runout.runoutDays !== null ? `${runout.runoutDays} days` : "unknown"}</p>
                  <p>Suggested reorder: {runout.suggestedReorderQuantity} {item.unitType}</p>
                </div>
              )) : <p>No low inventory alerts.</p>}
            </div>
          </div>
          <div className="panel">
            <h2>Customer Retention</h2>
            {customers.length ? (
              <div className="grid grid-2" style={{ marginTop: 12 }}>
                <div className="card stat"><span className="muted">Active Customers</span><strong>{retention.active}</strong></div>
                <div className="card stat"><span className="muted">At Risk</span><strong>{retention.atRisk}</strong></div>
                <div className="card stat"><span className="muted">Inactive</span><strong>{retention.inactive}</strong></div>
                <div className="card stat"><span className="muted">New This Month</span><strong>{retention.newThisMonth}</strong></div>
              </div>
            ) : <p>No customer history yet.</p>}
          </div>
        </aside>
      </section>
    </>
  );
}
