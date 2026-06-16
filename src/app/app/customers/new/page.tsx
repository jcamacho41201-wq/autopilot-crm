import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { createCustomerWithVehicleAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";

export default async function NewCustomerPage() {
  await requireUser();

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Customer CRM</p>
          <h1>Add Customer</h1>
          <p>Add the customer and their first vehicle. AutoPilot will create the default maintenance plan automatically.</p>
        </div>
        <Link className="button secondary" href="/app/customers"><ArrowLeft /> Customers</Link>
      </header>

      <section className="panel narrow-panel">
        <form className="form" action={createCustomerWithVehicleAction}>
          <h2>Customer Info</h2>
          <div className="form-row">
            <label>Customer name<input name="name" required placeholder="John Smith" /></label>
            <label>Phone number<input name="phone" required placeholder="555-0100" /></label>
          </div>
          <div className="form-row">
            <label>Email<input name="email" type="email" placeholder="john@example.com" /></label>
            <label>Communication preference
              <select name="communicationPrefs" defaultValue="SMS">
                <option>SMS</option>
                <option>Email</option>
                <option>SMS + email</option>
                <option>Phone</option>
              </select>
            </label>
          </div>

          <h2>Vehicle Info</h2>
          <div className="form-row">
            <label>Vehicle type
              <select name="vehicleType" defaultValue="Car">
                <option>Car</option>
                <option>SUV</option>
                <option>Truck</option>
                <option>Van</option>
                <option>Fleet vehicle</option>
                <option>Other</option>
              </select>
            </label>
            <label>Year<input name="year" type="number" required placeholder="2019" /></label>
          </div>
          <div className="form-row">
            <label>Make<input name="make" required placeholder="Toyota" /></label>
            <label>Model<input name="model" required placeholder="Camry" /></label>
          </div>
          <div className="form-row">
            <label>Trim<input name="trim" placeholder="Sport, XLT, EX-L" /></label>
            <label>VIN<input name="vin" /></label>
          </div>
          <label>License plate<input name="licensePlate" /></label>
          <div className="form-row">
            <label>Mileage<input name="currentMileage" type="number" min={0} required placeholder="61000" /></label>
            <label>Estimated miles/year<input name="estimatedMilesYear" type="number" min={0} defaultValue={12000} /></label>
          </div>
          <label>Notes<textarea name="notes" placeholder="Preferences, concerns, declined work, or follow-up context" /></label>
          <button className="button" type="submit"><UserPlus /> Create customer</button>
        </form>
      </section>
    </>
  );
}
