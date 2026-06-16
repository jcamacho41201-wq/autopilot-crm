import { CalendarPlus, MoveRight } from "lucide-react";
import { createAppointmentAction, moveAppointmentAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateLabel, dateTimeInputValue, money } from "@/lib/format";

function weekDays() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export default async function CalendarPage() {
  const user = await requireUser();
  const [appointments, customers, vehicles, technicians] = await Promise.all([
    prisma.appointment.findMany({
      where: { shopId: user.shopId },
      include: { customer: true, vehicle: true, technician: true },
      orderBy: { scheduledAt: "asc" }
    }),
    prisma.customer.findMany({ where: { shopId: user.shopId }, orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ where: { customer: { shopId: user.shopId } }, include: { customer: true } }),
    prisma.technician.findMany({ where: { shopId: user.shopId } })
  ]);
  const days = weekDays();

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Revenue planner</p>
          <h1>Shop Calendar</h1>
          <p>Add and move appointments, assign technicians, and watch daily revenue totals change.</p>
        </div>
      </header>

      <section className="split">
        <div className="panel">
          <div className="calendar">
            {days.map((day) => {
              const dayAppointments = appointments.filter((appointment) => appointment.scheduledAt.toDateString() === day.toDateString());
              const revenue = dayAppointments.reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);
              const minutes = dayAppointments.reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
              return (
                <div className="day" key={day.toISOString()}>
                  <div className="row">
                    <strong>{dateLabel(day)}</strong>
                    <span className="badge">{money.format(revenue)}</span>
                  </div>
                  <small className="muted">{Math.round((minutes / 480) * 100)}% capacity · {Math.max(0, 480 - minutes)} min open</small>
                  {dayAppointments.map((appointment) => (
                    <div className="appointment-chip" key={appointment.id}>
                      <strong>{appointment.scheduledAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</strong>
                      <div>{appointment.serviceName}</div>
                      <div>{appointment.customer.name} · {appointment.technician?.name ?? "Unassigned"}</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="grid">
          <form className="panel form" action={createAppointmentAction}>
            <h2>Add Appointment</h2>
            <label>Customer<select name="customerId">{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>Vehicle<select name="vehicleId">{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.customer.name} · {vehicle.make} {vehicle.model}</option>)}</select></label>
            <label>Technician<select name="technicianId"><option value="">Unassigned</option>{technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
            <label>When<input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInputValue(new Date(Date.now() + 86400000))} /></label>
            <div className="form-row">
              <label>Minutes<input name="durationMinutes" type="number" defaultValue={60} /></label>
              <label>Revenue<input name="estimatedRevenue" type="number" defaultValue={120} /></label>
            </div>
            <label>Service<input name="serviceName" required placeholder="Oil change" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button className="button" type="submit"><CalendarPlus /> Book</button>
          </form>

          <form className="panel form" action={moveAppointmentAction}>
            <h2>Move Appointment</h2>
            <label>Appointment
              <select name="id">
                {appointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{dateLabel(appointment.scheduledAt)} · {appointment.customer.name} · {appointment.serviceName}</option>)}
              </select>
            </label>
            <label>New time<input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInputValue(new Date(Date.now() + 2 * 86400000))} /></label>
            <label>Technician<select name="technicianId"><option value="">Unassigned</option>{technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
            <label>Status<select name="status"><option>BOOKED</option><option>COMPLETED</option><option>CANCELLED</option></select></label>
            <button className="button secondary" type="submit"><MoveRight /> Move</button>
          </form>
        </aside>
      </section>
    </>
  );
}
