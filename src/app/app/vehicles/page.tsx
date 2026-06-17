import Link from "next/link";
import { CalendarPlus, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { dateLabel, money, number } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

function statusTone(score: number) {
  if (score < 35) return "danger";
  if (score < 60) return "warn";
  return "ok";
}

export default async function VehiclesPage() {
  const user = await requireUser();
  const vehicles = await prisma.vehicle.findMany({
    where: { customer: { shopId: user.shopId } },
    include: {
      customer: true,
      mileageLogs: { orderBy: { loggedAt: "desc" } },
      maintenanceItems: { include: { service: true } },
      serviceRecords: { orderBy: { serviceDate: "desc" }, take: 1 },
      appointments: { where: { status: "BOOKED", scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 1 }
    },
    orderBy: { updatedAt: "desc" }
  });

  const rows = vehicles.map((vehicle) => {
    const maintenanceRows = vehicle.maintenanceItems
      .filter((item) => item.serviceId)
      .map((item) => ({
        item,
        prediction: maintenancePrediction({ ...item, vehicle: { ...vehicle, customer: vehicle.customer, mileageLogs: vehicle.mileageLogs } } as MaintenanceWithVehicle)
      }))
      .sort((a, b) => a.prediction.remainingLifePercentage - b.prediction.remainingLifePercentage);
    const opportunityRows = maintenanceRows.filter((row) => row.prediction.status === "Overdue" || row.prediction.status === "Due" || row.prediction.status === "Due Soon");
    const healthScore = maintenanceRows.length
      ? Math.round(maintenanceRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / maintenanceRows.length)
      : 100;
    return {
      vehicle,
      maintenanceRows,
      opportunityRows,
      healthScore,
      potentialRevenue: opportunityRows.reduce((sum, row) => sum + row.item.averagePrice, 0),
      missingTemplateCount: vehicle.maintenanceItems.filter((item) => !item.serviceId).length
    };
  }).sort((a, b) =>
    b.opportunityRows.filter((row) => row.prediction.status === "Overdue").length - a.opportunityRows.filter((row) => row.prediction.status === "Overdue").length ||
    b.potentialRevenue - a.potentialRevenue ||
    a.healthScore - b.healthScore
  );

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Vehicle opportunity index</p>
          <h1>Vehicles</h1>
          <p>Each vehicle is the source of mileage, service history, maintenance schedules, and predicted revenue opportunity.</p>
        </div>
        <Link className="button secondary" href="/app/maintenance"><Wrench /> Daily Queue</Link>
      </header>

      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Vehicles</span><strong>{vehicles.length}</strong><span className="badge">Profiles</span></div>
        <div className="card stat"><span className="muted">With Opportunity</span><strong>{rows.filter((row) => row.opportunityRows.length).length}</strong><span className="badge warn">Due or overdue</span></div>
        <div className="card stat"><span className="muted">Potential Revenue</span><strong>{money.format(rows.reduce((sum, row) => sum + row.potentialRevenue, 0))}</strong><span className="badge warn">Template-backed</span></div>
        <div className="card stat"><span className="muted">Needs Template Mapping</span><strong>{rows.reduce((sum, row) => sum + row.missingTemplateCount, 0)}</strong><span className="badge">Setup</span></div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="row">
          <h2>Vehicle Profiles</h2>
          <span className="badge">Customer → Vehicle → Service Template</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Vehicle</th><th>Customer</th><th>Mileage</th><th>Next Opportunity</th><th>Revenue</th><th>Health</th><th>Next Booking</th></tr></thead>
            <tbody>
              {rows.length ? rows.map(({ vehicle, opportunityRows, healthScore, potentialRevenue, missingTemplateCount }) => {
                const next = opportunityRows[0];
                return (
                  <tr key={vehicle.id}>
                    <td>
                      <Link className="text-link" href={`/app/customers/${vehicle.customerId}/vehicles/${vehicle.id}`}>{vehicle.year} {vehicle.make} {vehicle.model}</Link>
                      <br />
                      <span className="muted">VIN {vehicle.vin ?? "not set"} · Plate {vehicle.licensePlate ?? "not set"}</span>
                    </td>
                    <td><Link className="text-link" href={`/app/customers/${vehicle.customerId}`}>{vehicle.customer.name}</Link><br /><span className="muted">{vehicle.customer.phone}</span></td>
                    <td>{number.format(vehicle.currentMileage)} mi<br /><span className="muted">Last service {vehicle.serviceRecords[0]?.mileage ? `${number.format(vehicle.serviceRecords[0].mileage)} mi` : "none"}</span></td>
                    <td>
                      {next ? <><strong>{next.item.service?.name ?? next.item.name}</strong><br /><span className={`badge ${next.prediction.statusTone}`}>{next.prediction.status}</span></> : <span className="badge ok">Healthy</span>}
                      {missingTemplateCount ? <><br /><span className="badge warn">{missingTemplateCount} unmapped</span></> : null}
                    </td>
                    <td><strong>{money.format(potentialRevenue)}</strong></td>
                    <td><span className={`badge ${statusTone(healthScore)}`}>{healthScore}/100</span></td>
                    <td>{vehicle.appointments[0] ? `${dateLabel(vehicle.appointments[0].scheduledAt)} · ${vehicle.appointments[0].serviceName}` : <Link className="button secondary" href="/app/calendar"><CalendarPlus /> Book</Link>}</td>
                  </tr>
                );
              }) : <tr><td colSpan={7}>No vehicles yet. Add vehicles from a customer profile.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
