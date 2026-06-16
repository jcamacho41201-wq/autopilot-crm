import Link from "next/link";
import { CalendarPlus, Gauge } from "lucide-react";
import { createPublicBookingAction } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { dateTimeInputValue } from "@/lib/format";

export default async function PublicBookingPage({ params, searchParams }: { params: { slug: string }; searchParams: { booked?: string } }) {
  const shop = await prisma.shop.findUnique({ where: { slug: params.slug } });
  if (!shop) {
    return (
      <main className="booking-page section">
        <h1>Booking link not found</h1>
        <Link href="/">Go to AutoPilot CRM</Link>
      </main>
    );
  }
  const book = createPublicBookingAction.bind(null, params.slug);
  const firstSlot = new Date();
  firstSlot.setDate(firstSlot.getDate() + 1);
  firstSlot.setHours(10, 0, 0, 0);

  return (
    <main className="booking-page">
      <section className="section">
        <Link className="brand" href="/">
          <span className="brand-mark"><Gauge /></span>
          AutoPilot CRM
        </Link>
      </section>
      <section className="section split">
        <div>
          <p className="eyebrow">Public booking</p>
          <h1>{shop.name}</h1>
          <p>Choose an appointment slot and tell the shop what your vehicle needs. The booking appears in the shop calendar immediately.</p>
          {searchParams.booked ? <p className="badge ok">Appointment requested. The shop calendar has been updated.</p> : null}
        </div>
        <form className="panel form" action={book}>
          <h2>Book Service</h2>
          <div className="form-row"><label>Name<input name="name" required /></label><label>Phone<input name="phone" required /></label></div>
          <label>Email<input name="email" type="email" /></label>
          <div className="form-row"><label>Year<input name="year" type="number" required /></label><label>Make<input name="make" required /></label></div>
          <label>Model<input name="model" required /></label>
          <label>Current mileage<input name="currentMileage" type="number" required /></label>
          <label>Service
            <select name="serviceName">
              <option>Oil change</option>
              <option>Tire rotation</option>
              <option>Brake inspection</option>
              <option>Coolant flush</option>
              <option>Other service</option>
            </select>
          </label>
          <label>Preferred slot<input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInputValue(firstSlot)} /></label>
          <input type="hidden" name="estimatedRevenue" value="120" />
          <input type="hidden" name="durationMinutes" value="60" />
          <button className="button" type="submit"><CalendarPlus /> Request appointment</button>
        </form>
      </section>
    </main>
  );
}
