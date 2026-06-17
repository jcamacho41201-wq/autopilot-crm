import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, CheckCircle2, Plus, Save, Trash2, XCircle } from "lucide-react";
import {
  addAppointmentServiceAction,
  cancelAppointmentAction,
  completeAppointmentAction,
  removeAppointmentServiceAction,
  updateAppointmentAction
} from "@/lib/actions";
import { getVehicleVisitAppointments } from "@/lib/appointments";
import { requireUser } from "@/lib/auth";
import { dateLabel, dateTimeInputValue, money, yyyyMmDd } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export default async function AppointmentDetailsPage({
  params,
  searchParams
}: {
  params: { appointmentId: string };
  searchParams: { error?: string };
}) {
  const user = await requireUser();
  const appointment = await prisma.appointment.findFirst({
    where: { id: params.appointmentId, shopId: user.shopId },
    include: { customer: true, vehicle: true, technician: true, services: true }
  });
  if (!appointment) notFound();

  const [visitRows, technicians, maintenanceItems] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        shopId: user.shopId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        scheduledAt: appointment.scheduledAt
      },
      include: { customer: true, vehicle: true, technician: true, services: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.technician.findMany({ where: { shopId: user.shopId }, orderBy: { name: "asc" } }),
    prisma.maintenanceItem.findMany({
      where: { vehicleId: appointment.vehicleId, vehicle: { customer: { shopId: user.shopId } } },
      include: { service: true },
      orderBy: { name: "asc" }
    })
  ]);
  const visit = getVehicleVisitAppointments(visitRows)[0];
  const usedMaintenanceIds = new Set(visit.services.map((service) => service.maintenanceItemId).filter(Boolean));
  const availableMaintenanceItems = maintenanceItems.filter((item) => !usedMaintenanceIds.has(item.id));
  const vehicleLabel = `${appointment.vehicle.year} ${appointment.vehicle.make} ${appointment.vehicle.model}`;

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Vehicle visit</p>
          <h1>{appointment.customer.name}</h1>
          <p>{vehicleLabel} · {dateLabel(appointment.scheduledAt)} at {appointment.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
        </div>
        <Link className="button secondary" href="/app/calendar"><ArrowLeft /> Calendar</Link>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Services</span><strong>{visit.serviceCount}</strong><span className="badge">{visit.displayServiceSummary}</span></div>
        <div className="card stat"><span className="muted">Total Value</span><strong>{money.format(visit.totalValue)}</strong><span className="badge ok">Visit revenue</span></div>
        <div className="card stat"><span className="muted">Estimated Time</span><strong>{visit.displayDuration}</strong><span className="badge">Shop capacity</span></div>
        <div className="card stat"><span className="muted">Status</span><strong>{visit.status}</strong><span className="badge">Appointment</span></div>
        <div className="card stat"><span className="muted">Technician</span><strong>{visit.technician?.name ?? "Unassigned"}</strong><span className="badge">Owner</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="grid">
          <div className="panel">
            <div className="row">
              <h2>Services</h2>
              <span className="badge">{money.format(visit.totalValue)} total</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Service</th><th>Price</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {visit.services.length ? visit.services.map((service) => (
                    <tr key={service.id}>
                      <td><strong>{service.serviceName}</strong>{service.maintenanceItemId ? <><br /><span className="muted">Linked maintenance item</span></> : null}</td>
                      <td>{money.format(service.estimatedPrice)}</td>
                      <td>{service.estimatedDurationMinutes} min</td>
                      <td><span className="badge">{service.status}</span></td>
                      <td>
                        <form action={removeAppointmentServiceAction}>
                          <input type="hidden" name="appointmentServiceId" value={service.id} />
                          <button className="button danger-button" type="submit"><Trash2 /> Remove</button>
                        </form>
                      </td>
                    </tr>
                  )) : <tr><td colSpan={5}>No services attached yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2>Appointment Details</h2>
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="card"><strong>Customer</strong><p><Link href={`/app/customers/${appointment.customerId}`}>{appointment.customer.name}</Link></p></div>
              <div className="card"><strong>Vehicle</strong><p><Link href={`/app/customers/${appointment.customerId}/vehicles/${appointment.vehicleId}`}>{vehicleLabel}</Link></p></div>
              <div className="card"><strong>Date/Time</strong><p>{dateLabel(appointment.scheduledAt)} · {appointment.scheduledAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p></div>
              <div className="card"><strong>Notes</strong><p>{appointment.notes || "No notes yet."}</p></div>
            </div>
          </div>
        </div>

        <aside className="grid">
          <form className="panel form" action={updateAppointmentAction}>
            <h2>Edit Appointment</h2>
            <input type="hidden" name="id" value={appointment.id} />
            <input type="hidden" name="vehicleId" value={appointment.vehicleId} />
            <label>When<input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInputValue(appointment.scheduledAt)} /></label>
            <label>Technician
              <select name="technicianId" defaultValue={appointment.technicianId ?? ""}>
                <option value="">Unassigned</option>
                {technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
              </select>
            </label>
            <label>Status<select name="status" defaultValue={appointment.status}><option>BOOKED</option><option>COMPLETED</option><option>CANCELLED</option></select></label>
            <label>Notes<textarea name="notes" defaultValue={appointment.notes ?? ""} /></label>
            <button className="button secondary" type="submit"><Save /> Save appointment</button>
          </form>

          <form className="panel form" action={addAppointmentServiceAction}>
            <h2>Add Service</h2>
            <input type="hidden" name="appointmentId" value={appointment.id} />
            {availableMaintenanceItems.length ? (
              <label>Vehicle maintenance item
                <select name="maintenanceItemId">
                  <option value="">Manual service</option>
                  {availableMaintenanceItems.map((item) => <option key={item.id} value={item.id}>{item.service?.name ?? item.name} · {money.format(item.averagePrice)}</option>)}
                </select>
              </label>
            ) : null}
            <label>Manual service name<input name="serviceName" placeholder="Diagnostic inspection" /></label>
            <div className="form-row">
              <label>Price<input name="estimatedPrice" type="number" min={0} step="0.01" placeholder="Use maintenance price" /></label>
              <label>Minutes<input name="estimatedDurationMinutes" type="number" min={15} defaultValue={45} /></label>
            </div>
            <button className="button secondary" type="submit"><Plus /> Add service</button>
          </form>

          <form className="panel form" action={completeAppointmentAction}>
            <h2>Mark Completed</h2>
            <input type="hidden" name="id" value={appointment.id} />
            <label>Date<input name="serviceDate" type="date" defaultValue={yyyyMmDd(new Date())} required /></label>
            <label>Mileage<input name="mileage" type="number" min={0} defaultValue={appointment.vehicle.currentMileage} required /></label>
            <label>Completion notes<textarea name="notes" /></label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} type="checkbox" name="confirmLowerMileage" /> Confirm Lower Mileage</label>
            <button className="button" type="submit"><CheckCircle2 /> Complete and create records</button>
          </form>

          <form className="panel form danger-zone" action={cancelAppointmentAction}>
            <h2>Cancel Appointment</h2>
            <input type="hidden" name="id" value={appointment.id} />
            <p>This keeps the visit history visible but removes it from booked capacity and revenue.</p>
            <button className="button danger-button" type="submit"><XCircle /> Cancel appointment</button>
          </form>

          <Link className="button secondary" href={`/app/customers/${appointment.customerId}/vehicles/${appointment.vehicleId}`}><CalendarPlus /> Open Vehicle Dashboard</Link>
        </aside>
      </section>
    </>
  );
}
