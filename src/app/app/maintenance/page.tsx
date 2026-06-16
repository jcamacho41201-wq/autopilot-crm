import Link from "next/link";
import { CalendarPlus, FileText, MessageSquareText, Send, Wrench } from "lucide-react";
import { createAppointmentAction, generateQuoteFromMaintenanceAction, sendMockReminderAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, dateTimeInputValue, money, number } from "@/lib/format";
import { buildMaintenanceQueue, isOpenMaintenanceOpportunity, type MaintenanceQueueRow, type MaintenanceQueueSource } from "@/lib/maintenanceQueue";
import { prisma } from "@/lib/prisma";

function nextAppointmentTime() {
  const date = new Date(Date.now() + 86400000);
  date.setHours(9, 0, 0, 0);
  return date;
}

function severity(status: string) {
  if (status === "Overdue") return "🔴";
  if (status === "Due" || status === "Due Soon") return "🟡";
  return "🟢";
}

function serviceRevenue(rows: MaintenanceQueueRow[]) {
  return Array.from(
    rows
      .filter(isOpenMaintenanceOpportunity)
      .reduce((map, row) => {
        map.set(row.item.name, (map.get(row.item.name) ?? 0) + row.item.averagePrice);
        return map;
      }, new Map<string, number>())
  )
    .map(([service, revenue]) => ({ service, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 7);
}

function statusDistribution(rows: MaintenanceQueueRow[]) {
  return {
    healthy: rows.filter((row) => row.prediction.status === "Healthy").length,
    dueSoon: rows.filter((row) => row.prediction.status === "Due" || row.prediction.status === "Due Soon").length,
    overdue: rows.filter((row) => row.prediction.status === "Overdue").length
  };
}

function communicationQueue(cards: ReturnType<typeof buildMaintenanceQueue>["cards"]) {
  const noReminder = cards.filter((card) => !card.latestReminder).length;
  const reminded = cards.filter((card) => Boolean(card.latestReminder)).length;
  const overdueNoReminder = cards.filter((card) => card.overdueCount > 0 && !card.latestReminder).length;
  return { noReminder, reminded, overdueNoReminder };
}

function AppointmentForm({
  customerId,
  vehicleId,
  serviceName,
  revenue,
  label = "Book Appointment"
}: {
  customerId: string;
  vehicleId: string;
  serviceName: string;
  revenue: number;
  label?: string;
}) {
  return (
    <form action={createAppointmentAction}>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <input type="hidden" name="scheduledAt" value={dateTimeInputValue(nextAppointmentTime())} />
      <input type="hidden" name="durationMinutes" value={60} />
      <input type="hidden" name="serviceName" value={serviceName} />
      <input type="hidden" name="estimatedRevenue" value={revenue} />
      <input type="hidden" name="notes" value={`Booked from maintenance revenue pipeline for ${serviceName}.`} />
      <button className="button secondary" type="submit"><CalendarPlus /> {label}</button>
    </form>
  );
}

function ReminderForm({ maintenanceId, label = "Send Reminder" }: { maintenanceId?: string; label?: string }) {
  if (!maintenanceId) {
    return <Link className="button secondary" href="/app/reminders"><MessageSquareText /> {label}</Link>;
  }
  return (
    <form action={sendMockReminderAction}>
      <input type="hidden" name="maintenanceId" value={maintenanceId} />
      <button className="button secondary" type="submit"><MessageSquareText /> {label}</button>
    </form>
  );
}

function QuoteForm({ rows }: { rows: MaintenanceQueueRow[] }) {
  return (
    <form action={generateQuoteFromMaintenanceAction}>
      {rows.map((row) => <input key={row.item.id} type="hidden" name="maintenanceIds" value={row.item.id} />)}
      <button className="button" type="submit"><FileText /> Generate Quote</button>
    </form>
  );
}

function BarRow({ label, value, max, tone = "" }: { label: string; value: number; max: number; tone?: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 6 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <div className="mini-row"><span>{label}</span><strong>{number.format(value)}</strong></div>
      <div className={`bar-track ${tone}`}><span style={{ width: `${width}%` }} /></div>
    </div>
  );
}

export default async function MaintenancePage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requireUser();
  const maintenance = await prisma.maintenanceItem.findMany({
    where: { vehicle: { customer: { shopId: user.shopId } } },
    include: {
      vehicle: { include: { customer: true, mileageLogs: true } },
      reminders: { orderBy: { sentAt: "desc" }, take: 1 }
    },
    orderBy: { name: "asc" }
  });

  const queue = buildMaintenanceQueue(maintenance as MaintenanceQueueSource[]);
  const revenueByService = serviceRevenue(queue.rows);
  const distribution = statusDistribution(queue.rows);
  const communication = communicationQueue(queue.cards);
  const maxServiceRevenue = Math.max(1, ...revenueByService.map((item) => item.revenue));
  const maxDistribution = Math.max(distribution.healthy, distribution.dueSoon, distribution.overdue, 1);
  const maxCommunication = Math.max(communication.noReminder, communication.reminded, communication.overdueNoReminder, 1);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Revenue opportunity pipeline</p>
          <h1>Maintenance</h1>
          <p>Who should I contact today, and how much money is available if they book service?</p>
        </div>
        <Link className="button secondary" href="/app/reminders"><Send /> Send reminders</Link>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Overdue Revenue</span><strong>{money.format(queue.kpis.overdueRevenue)}</strong><span className="badge danger">Past due</span></div>
        <div className="card stat"><span className="muted">Due Soon Revenue</span><strong>{money.format(queue.kpis.dueSoonRevenue)}</strong><span className="badge warn">Ready to schedule</span></div>
        <div className="card stat"><span className="muted">Open Opportunity</span><strong>{money.format(queue.kpis.openOpportunities)}</strong><span className="badge">Available pipeline</span></div>
        <div className="card stat"><span className="muted">Vehicles To Contact</span><strong>{queue.kpis.vehiclesDue}</strong><span className="badge warn">Unique vehicles</span></div>
        <div className="card stat"><span className="muted">Customers Ready</span><strong>{queue.kpis.customersReady}</strong><span className="badge ok">Contact today</span></div>
      </section>

      <section className="maintenance-pipeline-grid" style={{ marginTop: 16 }}>
        <div className="panel maintenance-priority-panel">
          <div className="row">
            <h2>Contact Priority Queue</h2>
            <span className="badge warn">{money.format(queue.kpis.openOpportunities)} available</span>
          </div>
          <div className="contact-card-grid">
            {queue.cards.length ? queue.cards.map((card, index) => {
              const highest = card.highestPriority;
              const primaryService = highest?.item.name ?? "Maintenance service";
              const primaryRevenue = highest?.item.averagePrice ?? card.potentialRevenue;
              const priorityTone = card.overdueCount ? "danger" : "warn";
              return (
                <details className="contact-priority-card" key={card.vehicle.id} open={index === 0}>
                  <summary>
                    <div>
                      <span className={`badge ${priorityTone}`}>{card.overdueCount ? "🔴 Contact now" : "🟡 Contact soon"}</span>
                      <h3>{card.customer.name}</h3>
                      <p>{card.vehicle.year} {card.vehicle.make} {card.vehicle.model} · {number.format(card.vehicle.currentMileage)} mi</p>
                      <p>{highest ? `${severity(highest.prediction.status)} ${highest.item.name}` : "No active service"} · {card.latestReminder ? `Reminder ${card.latestReminder.status} ${dateLabel(card.latestReminder.sentAt)}` : "No reminder sent"}</p>
                    </div>
                    <div className="contact-card-revenue">
                      <strong>{money.format(card.potentialRevenue)}</strong>
                      <span>opportunity</span>
                    </div>
                  </summary>
                  <div className="contact-card-metrics">
                    <span className="badge danger">{card.overdueCount} overdue</span>
                    <span className="badge warn">{card.dueCount + card.dueSoonCount} due soon</span>
                    <span className={`badge ${card.healthScore < 35 ? "danger" : card.healthScore < 60 ? "warn" : "ok"}`}>{card.healthScore}/100 health</span>
                  </div>
                  <div className="queue-actions">
                    <Link className="button secondary" href={`/app/customers/${card.customer.id}/vehicles/${card.vehicle.id}`}><Wrench /> Open Vehicle</Link>
                    <ReminderForm maintenanceId={highest?.item.id} />
                    <AppointmentForm customerId={card.customer.id} vehicleId={card.vehicle.id} serviceName={primaryService} revenue={primaryRevenue} />
                    <QuoteForm rows={card.opportunityRows} />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Service</th><th>Status</th><th>Revenue</th><th>Due</th><th>Life</th></tr></thead>
                      <tbody>
                        {card.opportunityRows.map(({ item, prediction }) => (
                          <tr key={item.id}>
                            <td><strong>{item.name}</strong></td>
                            <td><span className={`badge ${prediction.statusTone}`}>{severity(prediction.status)} {prediction.status}</span></td>
                            <td>{money.format(item.averagePrice)}</td>
                            <td>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</td>
                            <td>
                              <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                              <small>{prediction.remainingLifePercentage}% remaining</small>
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
          <div className="panel">
            <h2>Communication Queue</h2>
            <div className="list" style={{ marginTop: 12 }}>
              <BarRow label="No reminder sent" value={communication.noReminder} max={maxCommunication} tone="danger" />
              <BarRow label="Reminder sent" value={communication.reminded} max={maxCommunication} tone="warn" />
              <BarRow label="Overdue, no reminder" value={communication.overdueNoReminder} max={maxCommunication} tone="danger" />
            </div>
          </div>
          <div className="panel">
            <h2>Maintenance Health Distribution</h2>
            <div className="list" style={{ marginTop: 12 }}>
              <BarRow label="Healthy" value={distribution.healthy} max={maxDistribution} tone="ok" />
              <BarRow label="Due Soon" value={distribution.dueSoon} max={maxDistribution} tone="warn" />
              <BarRow label="Overdue" value={distribution.overdue} max={maxDistribution} tone="danger" />
            </div>
          </div>
        </aside>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <h2>Revenue Opportunities by Service</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {revenueByService.length ? revenueByService.map((item) => (
              <div className="bar-row" key={item.service}>
                <div className="mini-row"><span>{item.service}</span><strong>{money.format(item.revenue)}</strong></div>
                <div className="bar-track"><span style={{ width: `${Math.max(8, Math.round((item.revenue / maxServiceRevenue) * 100))}%` }} /></div>
              </div>
            )) : <p>No revenue opportunities yet. Add maintenance intervals from a Vehicle Dashboard to begin forecasting service revenue.</p>}
          </div>
        </div>

        <aside className="panel">
          <h2>Pipeline Notes</h2>
          <div className="list" style={{ marginTop: 12 }}>
            <div className="card"><strong>Maintenance is follow-up here</strong><p>Create and edit service intervals from each Vehicle Dashboard.</p></div>
            <div className="card"><strong>Prioritize by revenue</strong><p>Cards are sorted by overdue services, opportunity value, due-soon count, and remaining life.</p></div>
          </div>
        </aside>
      </section>
    </>
  );
}
