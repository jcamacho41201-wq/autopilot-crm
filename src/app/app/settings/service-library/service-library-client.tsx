"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, Copy, Eye, PackagePlus, Pencil, Plus, Save, Search, Trash2, Wrench } from "lucide-react";
import {
  archiveServiceLibraryAction,
  createServiceLibraryAction,
  createServicePackageAction,
  deleteServiceLibraryAction,
  deleteServicePackageAction,
  duplicateServiceLibraryAction,
  duplicateServicePackageAction,
  importServiceTemplateAction,
  updateServiceLibraryAction,
  updateServicePackageAction
} from "@/lib/actions";
import { money, number } from "@/lib/format";

export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  defaultMileageInterval: number;
  defaultTimeIntervalMonths: number;
  averagePrice: number;
  defaultReminderThreshold: number;
  description: string | null;
  recommendedNotes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  assigned: number;
  dueSoon: number;
  overdue: number;
  projectedRevenue: number;
  overdueRevenue: number;
  conversionRate: number;
  packageCount: number;
};

export type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  serviceIds: string[];
  serviceNames: string[];
  servicesIncluded: number;
  vehiclesUsingPackage: number;
  projectedRevenue: number;
};

type Props = {
  categories: string[];
  error?: string;
  highestConversion: ServiceRow | null;
  highestRevenue: ServiceRow | null;
  mostOverdue: ServiceRow | null;
  mostUsed: ServiceRow | null;
  packages: PackageRow[];
  services: ServiceRow[];
  success?: string;
  totals: {
    activeServices: number;
    totalOverdueRevenue: number;
    totalRevenueOpportunity: number;
    totalServices: number;
    totalVehiclesCovered: number;
  };
};

function ServiceFields({ service, categories }: { service?: ServiceRow; categories: string[] }) {
  return (
    <>
      <label>Service Name<input name="name" defaultValue={service?.name ?? ""} required placeholder="Oil Change" /></label>
      <label>Category<input name="category" list="service-categories" defaultValue={service?.category ?? "Custom"} required /></label>
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

function PackageFields({ servicePackage, services }: { servicePackage?: PackageRow; services: ServiceRow[] }) {
  return (
    <>
      <label>Package name<input name="name" defaultValue={servicePackage?.name ?? ""} placeholder="Basic Maintenance" required /></label>
      <label>Description<textarea name="description" defaultValue={servicePackage?.description ?? ""} /></label>
      <label>Status
        <select name="status" defaultValue={servicePackage?.status ?? "ACTIVE"}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
      <div className="checkbox-grid">
        {services.map((service) => (
          <label key={service.id} className="checkbox-row">
            <input type="checkbox" name="serviceIds" value={service.id} defaultChecked={servicePackage?.serviceIds.includes(service.id)} />
            {service.name}
          </label>
        ))}
      </div>
    </>
  );
}

function UsageBar({ value, max }: { value: number; max: number }) {
  const width = max ? Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="usage-cell">
      <div className="bar-track"><span style={{ width: `${width}%` }} /></div>
      <strong>{number.format(value)}</strong>
    </div>
  );
}

export function ServiceLibraryClient({
  categories,
  error,
  highestConversion,
  highestRevenue,
  mostOverdue,
  mostUsed,
  packages,
  services,
  success,
  totals
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("projectedRevenue");
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [deleting, setDeleting] = useState<ServiceRow | null>(null);
  const [details, setDetails] = useState<ServiceRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [creatingPackage, setCreatingPackage] = useState(false);
  const [editingPackage, setEditingPackage] = useState<PackageRow | null>(null);
  const [importing, setImporting] = useState(false);
  const maxAssigned = Math.max(1, ...services.map((service) => service.assigned));
  const maxRevenue = Math.max(1, ...services.map((service) => service.projectedRevenue));

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return services
      .filter((service) => category === "All" || service.category === category)
      .filter((service) =>
        !normalizedQuery ||
        service.name.toLowerCase().includes(normalizedQuery) ||
        service.category.toLowerCase().includes(normalizedQuery) ||
        (service.description ?? "").toLowerCase().includes(normalizedQuery)
      )
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "price") return b.averagePrice - a.averagePrice;
        if (sort === "mileage") return b.defaultMileageInterval - a.defaultMileageInterval;
        if (sort === "assigned") return b.assigned - a.assigned;
        if (sort === "status") return a.status.localeCompare(b.status);
        return b.projectedRevenue - a.projectedRevenue;
      });
  }, [category, query, services, sort]);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Service Library</h1>
          <p>Shop Maintenance Configuration Center for reusable services, packages, forecasts, and vehicle schedules.</p>
        </div>
        <div className="row">
          <Link className="button secondary" href="/app/settings">Settings</Link>
          <button className="button secondary" type="button" onClick={() => setImporting(true)}><PackagePlus /> Import Templates</button>
          <button className="button" type="button" onClick={() => setAdding(true)}><Plus /> Add Service</button>
        </div>
      </header>
      {success ? <p className="badge ok" style={{ marginBottom: 16 }}>{success}</p> : null}
      {error ? <p className="badge danger" style={{ marginBottom: 16 }}>{error}</p> : null}

      <section className="grid grid-4">
        <div className="card stat"><span className="muted">Total Services</span><strong>{totals.totalServices}</strong><span className="badge">Library</span></div>
        <div className="card stat"><span className="muted">Active Services</span><strong>{totals.activeServices}</strong><span className="badge ok">Available</span></div>
        <div className="card stat"><span className="muted">Revenue Opportunity</span><strong>{money.format(totals.totalRevenueOpportunity)}</strong><span className="badge warn">Projected</span></div>
        <div className="card stat"><span className="muted">Overdue Revenue</span><strong>{money.format(totals.totalOverdueRevenue)}</strong><span className="badge danger">Needs action</span></div>
      </section>
      <section className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="card stat"><span className="muted">Most Used Service</span><strong>{mostUsed?.name ?? "None"}</strong><span className="badge">{mostUsed ? `${mostUsed.assigned} vehicles` : "No usage"}</span></div>
        <div className="card stat"><span className="muted">Highest Revenue Service</span><strong>{highestRevenue?.name ?? "None"}</strong><span className="badge warn">{highestRevenue ? money.format(highestRevenue.projectedRevenue) : "$0"}</span></div>
        <div className="card stat"><span className="muted">Most Overdue Service</span><strong>{mostOverdue?.name ?? "None"}</strong><span className="badge danger">{mostOverdue ? `${mostOverdue.overdue} overdue` : "No overdue"}</span></div>
        <div className="card stat"><span className="muted">Highest Conversion</span><strong>{highestConversion?.name ?? "None"}</strong><span className="badge ok">{highestConversion ? `${highestConversion.conversionRate}% completed` : "No history"}</span></div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="service-toolbar">
          <label className="search-control">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services..." />
          </label>
          <label>Sort
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="projectedRevenue">Projected Revenue</option>
              <option value="name">Service Name</option>
              <option value="price">Price</option>
              <option value="mileage">Mileage Interval</option>
              <option value="assigned">Vehicles Assigned</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>
        <div className="category-tabs">
          {["All", ...categories].map((tab) => (
            <button className={category === tab ? "active" : ""} key={tab} onClick={() => setCategory(tab)} type="button">{tab}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="library-table">
            <thead>
              <tr><th>Service</th><th>Interval</th><th>Price</th><th>Reminder</th><th>Usage</th><th>Projected Revenue</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.length ? filtered.map((service) => (
                <tr key={service.id}>
                  <td>
                    <button className="text-link plain-button" type="button" onClick={() => setDetails(service)}>{service.name}</button>
                    <br />
                    <span className="muted">{service.category} · {service.description ?? "No description"}</span>
                  </td>
                  <td>{number.format(service.defaultMileageInterval)} mi<br /><span className="muted">{service.defaultTimeIntervalMonths} months</span></td>
                  <td>{money.format(service.averagePrice)}</td>
                  <td>{service.defaultReminderThreshold}%</td>
                  <td><UsageBar value={service.assigned} max={maxAssigned} /></td>
                  <td>
                    <div className="revenue-cell">
                      <strong>{money.format(service.projectedRevenue)}</strong>
                      <div className="bar-track ok"><span style={{ width: `${Math.max(service.projectedRevenue ? 8 : 0, Math.round((service.projectedRevenue / maxRevenue) * 100))}%` }} /></div>
                    </div>
                  </td>
                  <td><span className={`badge ${service.status === "ACTIVE" ? "ok" : ""}`}>{service.status === "ACTIVE" ? "Active" : "Inactive"}</span></td>
                  <td>
                    <div className="icon-action-row">
                      <button className="icon-action" type="button" title="View details" onClick={() => setDetails(service)}><Eye /></button>
                      <button className="icon-action" type="button" title="Edit" onClick={() => setEditing(service)}><Pencil /></button>
                      <form action={duplicateServiceLibraryAction}><input type="hidden" name="serviceId" value={service.id} /><button className="icon-action" type="submit" title="Duplicate"><Copy /></button></form>
                      <form action={archiveServiceLibraryAction}><input type="hidden" name="serviceId" value={service.id} /><button className="icon-action" type="submit" title={service.status === "ACTIVE" ? "Archive" : "Activate"}><Archive /></button></form>
                      <button className="icon-action danger" type="button" title="Delete" onClick={() => setDeleting(service)}><Trash2 /></button>
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={8}>No services match your search.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel dashboard-wide">
          <div className="row">
            <h2>Maintenance Packages</h2>
            <button className="button secondary" type="button" onClick={() => setCreatingPackage(true)}><Plus /> Create Package</button>
          </div>
          <div className="grid grid-2" style={{ marginTop: 14 }}>
            {packages.length ? packages.map((servicePackage) => (
              <div className="card" key={servicePackage.id}>
                <div className="row">
                  <strong>{servicePackage.name}</strong>
                  <span className={`badge ${servicePackage.status === "ACTIVE" ? "ok" : ""}`}>{servicePackage.status}</span>
                </div>
                <p>{servicePackage.serviceNames.join(", ") || "No services selected"}</p>
                <div className="grid grid-3">
                  <div className="mini-stat"><span>Vehicles</span><strong>{servicePackage.vehiclesUsingPackage}</strong></div>
                  <div className="mini-stat"><span>Opportunity</span><strong>{money.format(servicePackage.projectedRevenue)}</strong></div>
                  <div className="mini-stat"><span>Services</span><strong>{servicePackage.servicesIncluded}</strong></div>
                </div>
                <div className="queue-actions">
                  <button className="button secondary" type="button" onClick={() => setEditingPackage(servicePackage)}><Save /> Edit</button>
                  <form action={duplicateServicePackageAction}><input type="hidden" name="packageId" value={servicePackage.id} /><button className="button secondary" type="submit"><Copy /> Duplicate</button></form>
                  <form action={deleteServicePackageAction}><input type="hidden" name="packageId" value={servicePackage.id} /><button className="button danger-button" type="submit"><Trash2 /> Delete</button></form>
                </div>
              </div>
            )) : <p>No service packages yet.</p>}
          </div>
        </div>
        <aside className="panel">
          <h2>Vehicles Covered</h2>
          <div className="card stat" style={{ marginTop: 12 }}><span className="muted">Total Vehicles Covered</span><strong>{totals.totalVehiclesCovered}</strong><span className="badge">Assigned services</span></div>
        </aside>
      </section>

      {adding ? (
        <div className="modal-backdrop">
          <div className="modal-panel static-modal">
            <div className="row"><h2>Add Service</h2><button className="button secondary" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
            <form className="form" action={createServiceLibraryAction}>
              <ServiceFields categories={categories} />
              <button className="button" type="submit"><Wrench /> Create service</button>
            </form>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="modal-backdrop">
          <div className="modal-panel static-modal">
            <div className="row"><h2>Edit Service</h2><button className="button secondary" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
            <form className="form" action={updateServiceLibraryAction}>
              <input type="hidden" name="serviceId" value={editing.id} />
              <ServiceFields service={editing} categories={categories} />
              <button className="button" type="submit"><Save /> Save</button>
            </form>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <div className="modal-backdrop">
          <div className="modal-panel static-modal">
            <h2>Delete {deleting.name}?</h2>
            <p>This service is assigned to {deleting.assigned} vehicle{deleting.assigned === 1 ? "" : "s"}.</p>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setDeleting(null)}>Cancel</button>
              <form action={archiveServiceLibraryAction}><input type="hidden" name="serviceId" value={deleting.id} /><button className="button secondary" type="submit"><Archive /> Archive Instead</button></form>
              <form action={deleteServiceLibraryAction}><input type="hidden" name="serviceId" value={deleting.id} /><input type="hidden" name="confirmDelete" value="on" /><button className="button danger-button" type="submit"><Trash2 /> Delete Permanently</button></form>
            </div>
          </div>
        </div>
      ) : null}

      {details ? (
        <div className="drawer-panel">
          <div className="row"><h2>{details.name}</h2><button className="button secondary" type="button" onClick={() => setDetails(null)}>Close</button></div>
          <p>{details.description ?? "No description yet."}</p>
          <div className="grid grid-2">
            <div className="mini-stat"><span>Mileage Interval</span><strong>{number.format(details.defaultMileageInterval)} mi</strong></div>
            <div className="mini-stat"><span>Time Interval</span><strong>{details.defaultTimeIntervalMonths} months</strong></div>
            <div className="mini-stat"><span>Default Price</span><strong>{money.format(details.averagePrice)}</strong></div>
            <div className="mini-stat"><span>Reminder</span><strong>{details.defaultReminderThreshold}%</strong></div>
            <div className="mini-stat"><span>Vehicles Assigned</span><strong>{details.assigned}</strong></div>
            <div className="mini-stat"><span>Overdue</span><strong>{details.overdue}</strong></div>
            <div className="mini-stat"><span>Due Soon</span><strong>{details.dueSoon}</strong></div>
            <div className="mini-stat"><span>Projected Revenue</span><strong>{money.format(details.projectedRevenue)}</strong></div>
            <div className="mini-stat"><span>Created</span><strong>{new Date(details.createdAt).toLocaleDateString()}</strong></div>
            <div className="mini-stat"><span>Last Updated</span><strong>{new Date(details.updatedAt).toLocaleDateString()}</strong></div>
          </div>
        </div>
      ) : null}

      {creatingPackage || editingPackage ? (
        <div className="modal-backdrop">
          <div className="modal-panel static-modal">
            <div className="row">
              <h2>{editingPackage ? "Edit Package" : "Create Package"}</h2>
              <button className="button secondary" type="button" onClick={() => { setCreatingPackage(false); setEditingPackage(null); }}>Cancel</button>
            </div>
            <form className="form" action={editingPackage ? updateServicePackageAction : createServicePackageAction}>
              {editingPackage ? <input type="hidden" name="packageId" value={editingPackage.id} /> : null}
              <PackageFields servicePackage={editingPackage ?? undefined} services={services} />
              <button className="button" type="submit"><PackagePlus /> {editingPackage ? "Save package" : "Create package"}</button>
            </form>
          </div>
        </div>
      ) : null}

      {importing ? (
        <div className="modal-backdrop">
          <div className="modal-panel static-modal">
            <div className="row"><h2>Import Service Templates</h2><button className="button secondary" type="button" onClick={() => setImporting(false)}>Cancel</button></div>
            <form className="form" action={importServiceTemplateAction}>
              <label>Template
                <select name="template" defaultValue="Independent Repair Shop">
                  <option>Quick Lube Shop</option>
                  <option>Independent Repair Shop</option>
                  <option>Fleet Maintenance</option>
                  <option>Diesel Shop</option>
                  <option>Dealership</option>
                </select>
              </label>
              <button className="button" type="submit"><PackagePlus /> Import templates</button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
