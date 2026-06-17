import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Phone,
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
  getRevenueByServiceType,
  getRevenueForecast,
  getRevenuePipeline,
  getTodayShopSnapshot,
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
  const hasData = data.some((point) => point.booked > 0 || point.predicted > 0 || point.overdue > 0);
  if (!hasData) {
    return <div className="chart-empty">No forecast data yet. Add appointments and maintenance intervals to generate a revenue forecast.</div>;
  }

  const width = 760;
  const height = 280;
  const pad = 36;
  const maxRevenue = Math.max(1, ...data.map((point) => point.total));
  const x = (index: number) => pad + (index / Math.max(1, data.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / maxRevenue) * (height - pad * 2);
  const points = (key: "booked" | "predicted" | "overdue" | "total") => data.map((point, index) => `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");

  return (
    <div className="chart-card">
      <svg className="revenue-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue forecast for the next 90 days">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} />
        <polyline className="total" points={points("total")} />
        <polyline className="booked" points={points("booked")} />
        <polyline className="predicted" points={points("predicted")} />
        <polyline className="overdue" points={points("overdue")} />
        <text x={pad} y={pad - 10}>{money.format(maxRevenue)}</text>
        <text x={pad} y={height - 8}>{dateLabel(data[0].start)}</text>
        <text x={width - pad - 46} y={height - 8}>{dateLabel(data[data.length - 1].start)}</text>
      </svg>
      <div className="chart-legend">
        <span><i className="legend-total" /> Total opportunity</span>
        <span><i className="legend-booked" /> Booked revenue</span>
        <span><i className="legend-predicted" /> Predicted maintenance</span>
        <span><i className="legend-overdue" /> Overdue revenue</span>
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

function healthLabel(score: number) {
  if (score >= 85) return "Healthy";
  if (score >= 60) return "Fair";
  if (score >= 35) return "Attention Needed";
  return "Critical";
}

function healthTone(score: number) {
  if (score >= 85) return "ok";
  if (score >= 60) return "warn";
  if (score >= 35) return "due";
  return "danger";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [appointments, maintenance, opportunities, inventory, reminderLogs] = await Promise.all([
    prisma.appointment.findMany({
      where: { shopId: user.shopId },
      orderBy: { scheduledAt: "asc" },
      include: { customer: true, vehicle: true, technician: true }
    }),
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: {
        service: true,
        vehicle: {
          include: {
            customer: true,
            mileageLogs: true,
            serviceRecords: { orderBy: { serviceDate: "desc" }, take: 1 },
            appointments: { orderBy: { scheduledAt: "desc" }, take: 12 }
          }
        },
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
    prisma.reminderLog.findMany({
      where: {
        sentAt: { gte: new Date(Date.now() - 30 * 86400000) },
        maintenanceItem: { vehicle: { customer: { shopId: user.shopId } } }
      }
    })
  ]);

  const asOf = new Date();
  const maintenanceRows = getMaintenanceRows(maintenance.filter((item) => item.serviceId), asOf);
  const vehicleCards = getVehiclesRequiringAttention(maintenanceRows, appointments, asOf);
  const snapshot = getTodayShopSnapshot(appointments, vehicleCards, asOf);
  const pipeline = getRevenuePipeline(appointments, vehicleCards, opportunities, asOf);
  const revenueForecast = getRevenueForecast(appointments, vehicleCards, asOf);
  const maintenanceStatus = getMaintenanceStatusBreakdown(maintenanceRows);
  const revenueByService = getRevenueByServiceType(maintenanceRows);
  const capacityForecast = getCapacityForecast(appointments, asOf);
  const inventoryAlerts = getLowInventoryAlerts(inventory);
  const upcoming = Array.from(
    new Map(
      appointments
        .filter((appointment) => appointment.scheduledAt >= asOf && appointment.status === "BOOKED")
        .map((appointment) => [appointment.id, appointment])
    ).values()
  ).slice(0, 5);
  const maxStatus = Math.max(maintenanceStatus.healthy, maintenanceStatus.dueSoon, maintenanceStatus.overdue, 1);
  const maxServiceRevenue = Math.max(1, ...revenueByService.map((item) => item.revenue));
  const maintenanceConversion = pipeline.totalOpportunity > 0 ? Math.round((pipeline.bookedRevenue / pipeline.totalOpportunity) * 100) : 0;
  const remindedCustomerIds = new Set(reminderLogs.map((log) => log.customerId).filter(Boolean));
  const bookedFromReminders = appointments
    .filter((appointment) => appointment.status === "BOOKED" && appointment.createdAt >= new Date(Date.now() - 30 * 86400000) && remindedCustomerIds.has(appointment.customerId))
    .length;
  const reminderPerformance = {
    textsSent: reminderLogs.filter((log) => log.status === "SENT" || log.status === "MOCK_SENT").length,
    emailsSent: 0,
    booked: bookedFromReminders,
    responseRate: reminderLogs.length ? Math.round((bookedFromReminders / reminderLogs.length) * 100) : 0
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Revenue-first maintenance command center</p>
          <h1>{user.shop.name}</h1>
          <p>Know who to contact, what vehicles are overdue, how full the calendar is, and which action creates revenue now.</p>
        </div>
        <div className="row">
          <Link className="button secondary" href={user.shop.bookingLink || `/booking/${user.shop.slug}`}><CalendarPlus /> Booking page</Link>
          <Link className="button" href="/app/reminders"><Send /> Send reminders</Link>
        </div>
      </header>

      <section className="grid grid-4">
        <Link className="card stat clickable-card" href="/app/calendar"><span className="muted">Cars Scheduled Today</span><strong>{snapshot.carsScheduledToday}</strong><span className="badge">{money.format(snapshot.bookedRevenueToday)} booked today</span></Link>
        <Link className="card stat clickable-card" href="/app/calendar"><span className="muted">Open Bays / Capacity</span><strong>{snapshot.openMinutesToday} min open</strong><span className="badge">{snapshot.utilizationToday}% utilized today</span></Link>
        <Link className="card stat clickable-card" href="/app/reminders"><span className="muted">Ready To Remind</span><strong>{snapshot.readyToRemind}</strong><span className="badge warn">customers</span></Link>
        <Link className="card stat clickable-card" href="/app/calendar"><span className="muted">Calendar Utilization</span><strong>{snapshot.calendarUtilization}%</strong><span className="badge">Next 7 days</span></Link>
      </section>

      <section className="grid grid-5" style={{ marginTop: 16 }}>
        <Link className="card stat clickable-card" href="/app/calendar"><span className="muted">Booked Revenue</span><strong>{money.format(pipeline.bookedRevenue)}</strong><span className="badge">Calendar confirmed</span></Link>
        <Link className="card stat clickable-card" href="/app/maintenance"><span className="muted">Predicted Revenue</span><strong>{money.format(pipeline.predictedRevenue)}</strong><span className="badge ok">Vehicle opportunities</span></Link>
        <Link className="card stat clickable-card" href="/app/maintenance"><span className="muted">Overdue Revenue</span><strong>{money.format(pipeline.overdueRevenue)}</strong><span className="badge danger">Vehicle opportunities</span></Link>
        <Link className="card stat clickable-card" href="/app/maintenance"><span className="muted">Total Opportunity</span><strong>{money.format(pipeline.totalOpportunity)}</strong><span className="badge warn">{vehicleCards.length} vehicles</span></Link>
        <Link className="card stat clickable-card" href="/app/forecast"><span className="muted">Maintenance Conversion</span><strong>{maintenanceConversion}%</strong><span className="badge ok">Revenue captured</span></Link>
      </section>
      <section className="grid grid-1" style={{ marginTop: 16 }}>
        <Link className="card stat clickable-card" href="/app/vehicles"><span className="muted">Deferred Opportunity</span><strong>{money.format(pipeline.deferredRevenue)}</strong><span className="badge">{opportunities.length} declined or postponed</span></Link>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <div className="row">
            <h2>Owner Action List</h2>
            <Link className="button secondary" href="/app/maintenance">Open Daily Revenue Queue</Link>
          </div>
          <div className="owner-action-list">
            {vehicleCards.length ? vehicleCards.map((card) => {
              const { Icon, badge, label } = priorityMeta(card.priority);
              return (
                <div className="card dashboard-attention-card owner-action-card" key={card.vehicle.id}>
                  <div className="row">
                    <div className="dashboard-attention-main">
                      <span className={`badge ${badge}`}><Icon size={15} /> {label}</span>
                      <div>
                        <strong>{card.customer.name}</strong>
                        <p>{vehicleName(card)} · {number.format(card.vehicle.currentMileage)} mi</p>
                        <p>{card.attentionRows[0]?.item.name ?? "Maintenance opportunity"} · {dueLabel(card)}</p>
                      </div>
                    </div>
                    <div className="priority-score">
                      <span>Priority Score</span>
                      <strong>{card.priorityScore}/100</strong>
                    </div>
                  </div>
                  <div className="owner-action-metrics">
                    <span className={`badge ${healthTone(card.healthScore)}`}>Health {card.healthScore}/100 · {healthLabel(card.healthScore)}</span>
                    <span className="badge danger">{card.overdueCount} overdue</span>
                    <span className="badge warn">{card.dueCount + card.dueSoonCount} due soon</span>
                    <span className="badge">{money.format(card.opportunityValue)} opportunity</span>
                    <span className="badge">{card.opportunityStatus}</span>
                  </div>
                  <div className="queue-preview">
                    <div className="queue-summary">
                      <span><strong>Next Best Action:</strong> {card.nextBestAction}</span>
                      <span><strong>Last Visit:</strong> {card.lastVisit ? dateLabel(card.lastVisit) : "No service history"}</span>
                    </div>
                    <div className="queue-actions">
                      <Link className="button secondary" href={`/app/customers/${card.customer.id}/vehicles/${card.vehicle.id}`}><Wrench /> Open Vehicle</Link>
                      <ReminderForm card={card} />
                      <AppointmentForm card={card} />
                      <a className="button secondary" href={`tel:${card.customer.phone.replace(/[^\d+]/g, "")}`}><Phone /> Call Customer</a>
                    </div>
                  </div>
                </div>
              );
            }) : <p>No vehicles need attention right now. Add service intervals from Vehicle Dashboards to begin predicting maintenance.</p>}
          </div>
        </div>

        <aside className="panel">
          <div className="row">
            <h2>Upcoming Appointments</h2>
            <Link className="button secondary" href="/app/calendar">View Full Calendar</Link>
          </div>
          <div className="appointment-compact-list">
            {upcoming.length ? upcoming.map((appointment) => (
              <div className="compact-appointment" key={appointment.id}>
                <strong>{dateLabel(appointment.scheduledAt)} · {appointment.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</strong>
                <span>{appointment.customer?.name ?? "Unknown customer"}</span>
                <span>{appointment.vehicle ? `${appointment.vehicle.year} ${appointment.vehicle.make} ${appointment.vehicle.model}` : "Unknown vehicle"}</span>
                <span>{appointment.serviceName}</span>
                <strong>{money.format(appointment.estimatedRevenue)}</strong>
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
              <details className="service-opportunity-row" key={item.service}>
                <summary>
                  <div className="bar-row">
                    <div className="mini-row">
                      <span>{item.service}</span>
                      <strong>{money.format(item.revenue)} · {item.vehicleCount} vehicle{item.vehicleCount === 1 ? "" : "s"}</strong>
                    </div>
                    <div className="bar-track"><span style={{ width: `${Math.max(8, Math.round((item.revenue / maxServiceRevenue) * 100))}%` }} /></div>
                  </div>
                </summary>
                <div className="service-vehicle-list">
                  {item.vehicles.map((vehicle) => (
                    <Link key={vehicle.id} href={`/app/customers/${vehicle.customerId}/vehicles/${vehicle.id}`}>
                      <span>{vehicle.customerName}</span>
                      <strong>{vehicle.label}</strong>
                      <span className={`badge ${vehicle.status === "Overdue" ? "danger" : "warn"}`}>{vehicle.status}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )) : <p>No open opportunities yet.</p>}
          </div>
        </div>
        <aside className="panel">
          <h2>Next 14 Days Capacity</h2>
          <div className="capacity-list">
            {capacityForecast.map((day) => (
              <div className="capacity-day" key={day.date.toISOString()}>
                <div className="mini-row"><span>{dateLabel(day.date)}</span><strong className={`badge ${day.tone}`}>{day.utilization}%</strong></div>
                <div className={`bar-track ${day.tone}`}><span style={{ width: `${Math.min(100, day.utilization)}%` }} /></div>
                <p>{day.scheduledHours}h scheduled · {day.availableHours}h available</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <h2>Low Inventory Alerts</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {inventoryAlerts.length ? inventoryAlerts.map(({ item, runout }) => (
              <div className="card" key={item.id}>
                <div className="row">
                  <strong>{item.name}</strong>
                  <span className="badge danger">{item.quantityOnHand} {item.unitType}</span>
                </div>
                <p>Threshold {item.reorderThreshold} {item.unitType} · Suggested reorder {runout.suggestedReorderQuantity} {item.unitType}</p>
              </div>
            )) : (
              <div className="card stat compact-status-card">
                <span className="muted">Inventory Status</span>
                <strong>Healthy</strong>
                <span className="badge ok">0 alerts</span>
              </div>
            )}
          </div>
        </div>
        <aside className="grid">
          <div className="panel">
            <h2>Reminder Performance</h2>
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="card stat"><span className="muted">Texts Sent</span><strong>{number.format(reminderPerformance.textsSent)}</strong></div>
              <div className="card stat"><span className="muted">Emails Sent</span><strong>{number.format(reminderPerformance.emailsSent)}</strong></div>
              <div className="card stat"><span className="muted">Booked</span><strong>{number.format(reminderPerformance.booked)}</strong></div>
              <div className="card stat"><span className="muted">Response Rate</span><strong>{reminderPerformance.responseRate}%</strong></div>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
