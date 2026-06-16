import Link from "next/link";
import { CalendarPlus, PackageSearch, Send, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateForecast, inventoryRunout, maintenancePrediction, utilization, type MaintenanceWithVehicle } from "@/lib/predictions";
import { dateLabel, money } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();
  const [appointments, maintenance, opportunities, inventory] = await Promise.all([
    prisma.appointment.findMany({
      where: { shopId: user.shopId },
      orderBy: { scheduledAt: "asc" },
      include: { customer: true, vehicle: true, technician: true }
    }),
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: { vehicle: { include: { customer: true, mileageLogs: true } } }
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
    })
  ]);

  const forecast = calculateForecast({
    maintenance: maintenance as MaintenanceWithVehicle[],
    appointments,
    opportunities
  });
  const due = forecast.predicted
    .filter(({ prediction }) => prediction.shouldRemind || prediction.isOverdue)
    .sort((a, b) => a.prediction.dueDate.getTime() - b.prediction.dueDate.getTime())
    .slice(0, 8);
  const upcoming = appointments.filter((appointment) => appointment.scheduledAt >= new Date()).slice(0, 6);
  const lowStock = inventory.filter((item) => item.quantityOnHand <= item.reorderThreshold);
  const calendarUtilization = utilization(appointments);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Today’s command center</p>
          <h1>{user.shop.name}</h1>
          <p>Predict demand, book the calendar, and turn future maintenance into scheduled revenue.</p>
        </div>
        <div className="row">
          <Link className="button secondary" href={user.shop.bookingLink || `/booking/${user.shop.slug}`}><CalendarPlus /> Booking page</Link>
          <Link className="button" href="/app/reminders"><Send /> Send reminders</Link>
        </div>
      </header>

      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Potential next 30 days</span><strong>{money.format(forecast.potential30)}</strong><span className="badge ok">{forecast.due30.length} predicted jobs</span></div>
        <div className="card stat"><span className="muted">Booked revenue</span><strong>{money.format(forecast.bookedRevenue)}</strong><span className="badge">Calendar confirmed</span></div>
        <div className="card stat"><span className="muted">Deferred opportunity</span><strong>{money.format(forecast.deferredRevenue)}</strong><span className="badge warn">{opportunities.length} open</span></div>
        <div className="card stat"><span className="muted">Calendar utilization</span><strong>{calendarUtilization}%</strong><span className="badge">Next 7 days</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="row">
            <h2>Customers Due For Service</h2>
            <Link href="/app/maintenance">View all</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Vehicle</th><th>Service</th><th>Life</th><th>Due</th><th>Revenue</th></tr></thead>
              <tbody>
                {due.map(({ item, prediction }) => (
                  <tr key={item.id}>
                    <td>{item.vehicle.customer.name}</td>
                    <td>{item.vehicle.year} {item.vehicle.make} {item.vehicle.model}</td>
                    <td>{item.name}</td>
                    <td>
                      <div className="progress"><span style={{ width: `${prediction.remainingLifePercentage}%` }} /></div>
                      <small>{prediction.remainingLifePercentage}% remaining</small>
                    </td>
                    <td><span className={`badge ${prediction.isOverdue ? "danger" : "warn"}`}>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</span></td>
                    <td>{money.format(item.averagePrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="grid">
          <div className="panel">
            <h2>Upcoming Appointments</h2>
            <div className="list">
              {upcoming.map((appointment) => (
                <div className="card" key={appointment.id}>
                  <div className="row">
                    <strong>{appointment.serviceName}</strong>
                    <span className="badge">{money.format(appointment.estimatedRevenue)}</span>
                  </div>
                  <p>{dateLabel(appointment.scheduledAt)} · {appointment.customer.name} · {appointment.vehicle.make} {appointment.vehicle.model}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2>Low Inventory Alerts</h2>
            <div className="list">
              {lowStock.map((item) => {
                const runout = inventoryRunout(item);
                return (
                  <div className="card" key={item.id}>
                    <div className="row">
                      <strong>{item.name}</strong>
                      <span className="badge danger">{item.quantityOnHand} {item.unitType}</span>
                    </div>
                    <p>Average usage: {runout.monthlyUsage} / month. Runout: {runout.runoutDays ?? "unknown"} days.</p>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </section>

      <section className="grid grid-3" style={{ marginTop: 16 }}>
        <div className="panel stat"><TrendingUp /><span className="muted">Potential 60 days</span><strong>{money.format(forecast.potential60)}</strong></div>
        <div className="panel stat"><TrendingUp /><span className="muted">Potential 90 days</span><strong>{money.format(forecast.potential90)}</strong></div>
        <div className="panel stat"><PackageSearch /><span className="muted">Overdue revenue</span><strong>{money.format(forecast.overdueRevenue)}</strong></div>
      </section>
    </>
  );
}
