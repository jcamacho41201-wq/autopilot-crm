import { requireUser } from "@/lib/auth";
import { sendMockReminderAction } from "@/lib/actions";
import { getVehicleVisitAppointments } from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { buildMaintenanceQueue, type MaintenanceQueueSource } from "@/lib/maintenanceQueue";
import { calculateForecast, type MaintenanceWithVehicle } from "@/lib/predictions";
import { dateLabel, money } from "@/lib/format";

export default async function ForecastPage() {
  const user = await requireUser();
  const [maintenance, appointments, opportunities] = await Promise.all([
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: { vehicle: { include: { customer: true, mileageLogs: true } } }
    }),
    prisma.appointment.findMany({ where: { shopId: user.shopId }, include: { services: true } }),
    prisma.deferredOpportunity.findMany({
      where: { shopId: user.shopId },
      include: { vehicle: { include: { customer: true } } },
      orderBy: { followUpDate: "asc" }
    })
  ]);
  const vehicleVisitAppointments = getVehicleVisitAppointments(appointments);
  const queue = buildMaintenanceQueue(maintenance as MaintenanceQueueSource[]);
  const forecast = calculateForecast({
    maintenance: maintenance as MaintenanceWithVehicle[],
    predicted: queue.rows,
    appointments: vehicleVisitAppointments,
    opportunities
  });
  const topPredicted = queue.opportunityRows
    .sort((a, b) => b.item.averagePrice - a.item.averagePrice)
    .slice(0, 8);
  const serviceGroups = forecast.due30.reduce<Record<string, { count: number; revenue: number }>>((acc, row) => {
    acc[row.item.name] ??= { count: 0, revenue: 0 };
    acc[row.item.name].count += 1;
    acc[row.item.name].revenue += row.item.averagePrice;
    return acc;
  }, {});

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Revenue forecasting</p>
          <h1>Forecast</h1>
          <p>Blend booked appointments, predicted maintenance, overdue work, and deferred opportunities.</p>
        </div>
      </header>
      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Scheduled revenue</span><strong>{money.format(forecast.bookedRevenue)}</strong></div>
        <div className="card stat"><span className="muted">Maintenance queue</span><strong>{money.format(queue.kpis.openOpportunities)}</strong></div>
        <div className="card stat"><span className="muted">Overdue revenue</span><strong>{money.format(queue.kpis.overdueRevenue)}</strong></div>
        <div className="card stat"><span className="muted">Total opportunity</span><strong>{money.format(forecast.potential90 + forecast.deferredRevenue + forecast.bookedRevenue)}</strong></div>
      </section>
      <section className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="muted">Next 30 days</span><strong>{money.format(forecast.potential30)}</strong></div>
        <div className="card stat"><span className="muted">Next 60 days</span><strong>{money.format(forecast.potential60)}</strong></div>
        <div className="card stat"><span className="muted">Next 90 days</span><strong>{money.format(forecast.potential90)}</strong></div>
        <div className="card stat"><span className="muted">Open deferred work</span><strong>{money.format(forecast.deferredRevenue)}</strong></div>
      </section>
      <section className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          <h2>Next 30 Days By Service</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Jobs</th><th>Average price</th><th>Total</th></tr></thead>
              <tbody>
                {Object.entries(serviceGroups).map(([service, row]) => (
                  <tr key={service}>
                    <td>{service}</td>
                    <td>{row.count}</td>
                    <td>{money.format(row.revenue / row.count)}</td>
                    <td>{money.format(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="panel">
          <h2>Top Opportunities</h2>
          <div className="list">
            {topPredicted.map(({ item, prediction }) => (
              <div className="card" key={item.id}>
                <div className="row"><strong>{item.vehicle.customer.name}</strong><span className="badge warn">{money.format(item.averagePrice)}</span></div>
                <p>{item.vehicle.year} {item.vehicle.make} {item.vehicle.model} · {item.name} · due {dateLabel(prediction.dueDate)}</p>
                <form action={sendMockReminderAction}>
                  <input type="hidden" name="maintenanceId" value={item.id} />
                  <button className="button secondary" type="submit">Send reminder</button>
                </form>
              </div>
            ))}
            {opportunities.filter((opportunity) => opportunity.status === "OPEN").slice(0, 4).map((opportunity) => (
              <div className="card" key={opportunity.id}>
                <div className="row"><strong>{opportunity.vehicle.customer.name}</strong><span className="badge warn">{money.format(opportunity.estimatedRevenue)}</span></div>
                <p>{opportunity.vehicle.year} {opportunity.vehicle.make} {opportunity.vehicle.model} · {opportunity.description} · follow up {dateLabel(opportunity.followUpDate)}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </>
  );
}
