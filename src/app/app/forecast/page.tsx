import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateForecast, type MaintenanceWithVehicle } from "@/lib/predictions";
import { dateLabel, money } from "@/lib/format";

export default async function ForecastPage() {
  const user = await requireUser();
  const [maintenance, appointments, opportunities] = await Promise.all([
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: { vehicle: { include: { customer: true, mileageLogs: true } } }
    }),
    prisma.appointment.findMany({ where: { shopId: user.shopId } }),
    prisma.deferredOpportunity.findMany({
      where: { shopId: user.shopId },
      include: { vehicle: { include: { customer: true } } },
      orderBy: { followUpDate: "asc" }
    })
  ]);
  const forecast = calculateForecast({ maintenance: maintenance as MaintenanceWithVehicle[], appointments, opportunities });
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
        <div className="card stat"><span className="muted">30 days</span><strong>{money.format(forecast.potential30)}</strong></div>
        <div className="card stat"><span className="muted">60 days</span><strong>{money.format(forecast.potential60)}</strong></div>
        <div className="card stat"><span className="muted">90 days</span><strong>{money.format(forecast.potential90)}</strong></div>
        <div className="card stat"><span className="muted">Total with deferred</span><strong>{money.format(forecast.potential90 + forecast.deferredRevenue + forecast.bookedRevenue)}</strong></div>
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
          <h2>Open Opportunities</h2>
          <div className="list">
            {opportunities.filter((opportunity) => opportunity.status === "OPEN").map((opportunity) => (
              <div className="card" key={opportunity.id}>
                <div className="row"><strong>{opportunity.description}</strong><span className="badge warn">{money.format(opportunity.estimatedRevenue)}</span></div>
                <p>{opportunity.vehicle.customer.name} · Follow up {dateLabel(opportunity.followUpDate)}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </>
  );
}
