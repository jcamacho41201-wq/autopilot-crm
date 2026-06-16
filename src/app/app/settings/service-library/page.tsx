import Link from "next/link";
import { Archive, Copy, Plus, Save, Trash2, Wrench } from "lucide-react";
import {
  archiveServiceLibraryAction,
  createServiceLibraryAction,
  createServicePackageAction,
  deleteServiceLibraryAction,
  deleteServicePackageAction,
  duplicateServiceLibraryAction,
  updateServiceLibraryAction,
  updateServicePackageAction
} from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { money, number } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

const fallbackCategories = [
  "Fluids",
  "Brakes",
  "Filters",
  "Engine",
  "Cooling System",
  "Suspension",
  "Electrical",
  "Inspection",
  "Custom"
];

type ServiceWithUsage = Awaited<ReturnType<typeof prisma.service.findMany>>[number];

function ServiceFields({
  service,
  categories
}: {
  service?: ServiceWithUsage;
  categories: string[];
}) {
  return (
    <>
      <label>Service Name<input name="name" defaultValue={service?.name ?? ""} required placeholder="Oil Change" /></label>
      <label>Category
        <input name="category" list="service-categories" defaultValue={service?.category ?? "Custom"} required />
      </label>
      <datalist id="service-categories">
        {categories.map((category) => <option key={category} value={category} />)}
      </datalist>
      <div className="form-row">
        <label>Mileage Interval<input name="defaultMileageInterval" type="number" min={1} defaultValue={service?.defaultMileageInterval ?? 5000} required /></label>
        <label>Time Interval Months<input name="defaultTimeIntervalMonths" type="number" min={1} defaultValue={service?.defaultTimeIntervalMonths ?? 6} required /></label>
      </div>
      <div className="form-row">
        <label>Default Price<input name="averagePrice" type="number" min={0} step="0.01" defaultValue={service?.averagePrice ?? 89} required /></label>
        <label>Reminder Threshold %<input name="defaultReminderThreshold" type="number" min={0} max={100} defaultValue={service?.defaultReminderThreshold ?? 20} required /></label>
      </div>
      <label>Description<textarea name="description" defaultValue={service?.description ?? ""} placeholder="Standard conventional oil service." /></label>
      <label>Recommended Notes<textarea name="recommendedNotes" defaultValue={service?.recommendedNotes ?? ""} placeholder="Inspect filter housing and reset oil life monitor." /></label>
      <label>Status
        <select name="status" defaultValue={service?.status ?? "ACTIVE"}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
    </>
  );
}

export default async function ServiceLibraryPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requireUser();
  const [services, packages] = await Promise.all([
    prisma.service.findMany({
      where: { shopId: user.shopId },
      include: {
        maintenanceItems: {
          include: { vehicle: { include: { customer: true, mileageLogs: true } } }
        },
        packageItems: true
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    }),
    prisma.servicePackage.findMany({
      where: { shopId: user.shopId },
      include: { items: { include: { service: true } } },
      orderBy: { name: "asc" }
    })
  ]);

  const serviceStats = services.map((service) => {
    const rows = service.maintenanceItems.map((item) => ({
      item,
      prediction: maintenancePrediction(item as MaintenanceWithVehicle)
    }));
    const assigned = new Set(service.maintenanceItems.map((item) => item.vehicleId)).size;
    const dueSoon = rows.filter((row) => row.prediction.status === "Due" || row.prediction.status === "Due Soon").length;
    const overdue = rows.filter((row) => row.prediction.status === "Overdue").length;
    const projectedRevenue = rows
      .filter((row) => row.prediction.status === "Overdue" || row.prediction.status === "Due" || row.prediction.status === "Due Soon")
      .reduce((sum, row) => sum + row.item.averagePrice, 0);
    return { service, assigned, dueSoon, overdue, projectedRevenue };
  });

  const mostUsed = [...serviceStats].sort((a, b) => b.assigned - a.assigned)[0];
  const highestRevenue = [...serviceStats].sort((a, b) => b.projectedRevenue - a.projectedRevenue)[0];
  const totalVehiclesCovered = new Set(services.flatMap((service) => service.maintenanceItems.map((item) => item.vehicleId))).size;
  const categories = Array.from(new Set([...fallbackCategories, ...services.map((service) => service.category)])).sort();
  const grouped = categories
    .map((category) => ({ category, services: serviceStats.filter((row) => row.service.category === category) }))
    .filter((group) => group.services.length);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Service Library</h1>
          <p>Manage the maintenance catalog that powers vehicle schedules, reminders, revenue forecasts, and service packages.</p>
        </div>
        <div className="row">
          <Link className="button secondary" href="/app/settings">Settings</Link>
          <details className="inline-details modal-details">
            <summary className="button"><Plus /> Add Service</summary>
            <div className="modal-panel">
              <form className="form" action={createServiceLibraryAction}>
                <ServiceFields categories={categories} />
                <button className="button" type="submit"><Wrench /> Create service</button>
              </form>
            </div>
          </details>
        </div>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Total Services</span><strong>{services.length}</strong><span className="badge">Library</span></div>
        <div className="card stat"><span className="muted">Active Services</span><strong>{services.filter((service) => service.status === "ACTIVE").length}</strong><span className="badge ok">Available</span></div>
        <div className="card stat"><span className="muted">Most Used</span><strong>{mostUsed?.service.name ?? "None"}</strong><span className="badge">{mostUsed ? `${mostUsed.assigned} vehicles` : "No usage"}</span></div>
        <div className="card stat"><span className="muted">Highest Revenue</span><strong>{highestRevenue?.service.name ?? "None"}</strong><span className="badge warn">{highestRevenue ? money.format(highestRevenue.projectedRevenue) : "$0"}</span></div>
        <div className="card stat"><span className="muted">Vehicles Covered</span><strong>{totalVehiclesCovered}</strong><span className="badge">Assigned</span></div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="row">
          <h2>Service Library</h2>
          <span className="badge">{categories.length} categories</span>
        </div>
        <div className="list" style={{ marginTop: 14 }}>
          {grouped.length ? grouped.map((group) => (
            <div className="service-category-group" key={group.category}>
              <h3>{group.category}</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Service Name</th><th>Mileage Interval</th><th>Time Interval</th><th>Default Price</th><th>Reminder %</th><th>Vehicles Assigned</th><th>Projected Revenue</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.services.map(({ service, assigned, dueSoon, overdue, projectedRevenue }) => (
                      <tr key={service.id}>
                        <td><strong>{service.name}</strong><br /><span className="muted">{service.description ?? "No description"}</span></td>
                        <td>{number.format(service.defaultMileageInterval)} mi</td>
                        <td>{service.defaultTimeIntervalMonths} months</td>
                        <td>{money.format(service.averagePrice)}</td>
                        <td>{service.defaultReminderThreshold}%</td>
                        <td>{assigned}<br /><span className="muted">{overdue} overdue · {dueSoon} due soon</span></td>
                        <td>{money.format(projectedRevenue)}</td>
                        <td><span className={`badge ${service.status === "ACTIVE" ? "ok" : ""}`}>{service.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
                        <td>
                          <details className="inline-details">
                            <summary className="button ghost">Edit</summary>
                            <form className="form compact-form" action={updateServiceLibraryAction}>
                              <input type="hidden" name="serviceId" value={service.id} />
                              <ServiceFields service={service} categories={categories} />
                              <button className="button secondary" type="submit"><Save /> Save</button>
                            </form>
                          </details>
                          <div className="queue-actions">
                            <form action={duplicateServiceLibraryAction}>
                              <input type="hidden" name="serviceId" value={service.id} />
                              <button className="button secondary" type="submit"><Copy /> Duplicate</button>
                            </form>
                            <form action={archiveServiceLibraryAction}>
                              <input type="hidden" name="serviceId" value={service.id} />
                              <button className="button secondary" type="submit"><Archive /> {service.status === "ACTIVE" ? "Archive" : "Activate"}</button>
                            </form>
                          </div>
                          <form className="form danger-zone" action={deleteServiceLibraryAction}>
                            <input type="hidden" name="serviceId" value={service.id} />
                            {assigned ? <p>This service is currently assigned to {assigned} vehicle{assigned === 1 ? "" : "s"}.</p> : null}
                            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmDelete" /> Confirm delete</label>
                            <button className="button danger-button" type="submit"><Trash2 /> Delete</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )) : <p>No services yet. Add your first service to begin creating reusable maintenance templates.</p>}
        </div>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <h2>Service Packages</h2>
          <div className="grid grid-2" style={{ marginTop: 14 }}>
            {packages.length ? packages.map((servicePackage) => (
              <details className="card detail-card" key={servicePackage.id}>
                <summary>
                  <div>
                    <strong>{servicePackage.name}</strong>
                    <p>{servicePackage.items.map((item) => item.service.name).join(", ") || "No services selected"}</p>
                  </div>
                  <span className={`badge ${servicePackage.status === "ACTIVE" ? "ok" : ""}`}>{servicePackage.status}</span>
                </summary>
                <form className="form" action={updateServicePackageAction} style={{ marginTop: 12 }}>
                  <input type="hidden" name="packageId" value={servicePackage.id} />
                  <label>Package name<input name="name" defaultValue={servicePackage.name} required /></label>
                  <label>Description<textarea name="description" defaultValue={servicePackage.description ?? ""} /></label>
                  <label>Status
                    <select name="status" defaultValue={servicePackage.status}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                  <div className="checkbox-grid">
                    {services.map((service) => (
                      <label key={service.id} className="checkbox-row">
                        <input type="checkbox" name="serviceIds" value={service.id} defaultChecked={servicePackage.items.some((item) => item.serviceId === service.id)} />
                        {service.name}
                      </label>
                    ))}
                  </div>
                  <button className="button secondary" type="submit"><Save /> Save package</button>
                </form>
                <form className="form danger-zone" action={deleteServicePackageAction}>
                  <input type="hidden" name="packageId" value={servicePackage.id} />
                  <button className="button danger-button" type="submit"><Trash2 /> Delete package</button>
                </form>
              </details>
            )) : <p>No service packages yet.</p>}
          </div>
        </div>
        <aside className="panel">
          <h2>Create Package</h2>
          <form className="form" action={createServicePackageAction}>
            <label>Package name<input name="name" placeholder="Basic Maintenance Package" required /></label>
            <label>Description<textarea name="description" placeholder="Oil change, tire rotation, and brake inspection." /></label>
            <label>Status
              <select name="status" defaultValue="ACTIVE">
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <div className="checkbox-grid">
              {services.map((service) => (
                <label key={service.id} className="checkbox-row">
                  <input type="checkbox" name="serviceIds" value={service.id} />
                  {service.name}
                </label>
              ))}
            </div>
            <button className="button" type="submit"><Plus /> Create package</button>
          </form>
        </aside>
      </section>
    </>
  );
}
