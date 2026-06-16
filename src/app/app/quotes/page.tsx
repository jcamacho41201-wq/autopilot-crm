import Link from "next/link";
import { CalendarPlus, Copy, FileText, Mail, MessageSquareText, Plus } from "lucide-react";
import { createQuoteAction, duplicateQuoteAction, sendQuoteAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, money, yyyyMmDd } from "@/lib/format";
import { prisma } from "@/lib/prisma";

function quoteBadge(status: string) {
  if (status === "APPROVED") return "ok";
  if (status === "DECLINED" || status === "EXPIRED") return "danger";
  if (status === "SENT") return "warn";
  return "";
}

export default async function QuotesPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requireUser();
  const [quotes, customers, vehicles, services, maintenanceItems] = await Promise.all([
    prisma.quote.findMany({
      where: { shopId: user.shopId },
      include: { customer: true, vehicle: true, lines: true },
      orderBy: { updatedAt: "desc" }
    }),
    prisma.customer.findMany({ where: { shopId: user.shopId }, orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ where: { customer: { shopId: user.shopId } }, include: { customer: true }, orderBy: { updatedAt: "desc" } }),
    prisma.service.findMany({ where: { shopId: user.shopId, status: "ACTIVE" }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.maintenanceItem.findMany({
      where: { vehicle: { customer: { shopId: user.shopId } } },
      include: { vehicle: { include: { customer: true } } },
      orderBy: { name: "asc" },
      take: 80
    })
  ]);
  const approved = quotes.filter((quote) => quote.status === "APPROVED");
  const pending = quotes.filter((quote) => quote.status === "DRAFT" || quote.status === "SENT");
  const conversionRate = quotes.length ? Math.round((approved.length / quotes.length) * 100) : 0;
  const revenueGenerated = approved.reduce((sum, quote) => sum + quote.total, 0);
  const expiringSoon = new Date();
  expiringSoon.setDate(expiringSoon.getDate() + 14);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Revenue CRM</p>
          <h1>Estimates / Quotes</h1>
          <p>Build estimates from recommended maintenance, send approvals, and convert accepted work into booked revenue.</p>
        </div>
        <Link className="button secondary" href="/app/maintenance"><CalendarPlus /> Find opportunities</Link>
      </header>
      {searchParams.error ? <p className="badge danger" style={{ marginBottom: 16 }}>{searchParams.error}</p> : null}

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Quotes Created</span><strong>{quotes.length}</strong><span className="badge">All time</span></div>
        <div className="card stat"><span className="muted">Approved Quotes</span><strong>{approved.length}</strong><span className="badge ok">{money.format(revenueGenerated)}</span></div>
        <div className="card stat"><span className="muted">Pending Quotes</span><strong>{pending.length}</strong><span className="badge warn">{money.format(pending.reduce((sum, quote) => sum + quote.total, 0))}</span></div>
        <div className="card stat"><span className="muted">Declined Quotes</span><strong>{quotes.filter((quote) => quote.status === "DECLINED").length}</strong><span className="badge danger">Lost</span></div>
        <div className="card stat"><span className="muted">Approval Rate</span><strong>{conversionRate}%</strong><span className="badge">Conversion</span></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="row">
            <h2>Quote Pipeline</h2>
            <span className="badge warn">{money.format(quotes.filter((quote) => quote.status !== "DECLINED").reduce((sum, quote) => sum + quote.total, 0))} open value</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quote</th><th>Customer</th><th>Vehicle</th><th>Expires</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {quotes.length ? quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td><Link className="text-link" href={`/app/quotes/${quote.id}`}>{quote.quoteNumber}</Link><br /><span className="muted">{dateLabel(quote.issueDate)} · {quote.lines.length} line items</span></td>
                    <td>{quote.customer.name}</td>
                    <td>{quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}</td>
                    <td>{dateLabel(quote.expirationDate)}</td>
                    <td><strong>{money.format(quote.total)}</strong></td>
                    <td><span className={`badge ${quoteBadge(quote.status)}`}>{quote.expirationDate < new Date() && quote.status !== "APPROVED" ? "EXPIRED" : quote.status}</span></td>
                    <td>
                      <div className="icon-action-row">
                        <form action={sendQuoteAction}><input type="hidden" name="quoteId" value={quote.id} /><button className="icon-action" title="Email quote" type="submit"><Mail /></button></form>
                        <form action={sendQuoteAction}><input type="hidden" name="quoteId" value={quote.id} /><button className="icon-action" title="SMS quote" type="submit"><MessageSquareText /></button></form>
                        <form action={duplicateQuoteAction}><input type="hidden" name="quoteId" value={quote.id} /><button className="icon-action" title="Duplicate" type="submit"><Copy /></button></form>
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={7}>No quotes yet. Create one from the form or generate one from Maintenance.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="grid">
          <form className="panel form" action={createQuoteAction}>
            <h2>Create Quote</h2>
            <label>Customer
              <select name="customerId" required>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
            </label>
            <label>Vehicle
              <select name="vehicleId" required>
                {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.customer.name} · {vehicle.year} {vehicle.make} {vehicle.model}</option>)}
              </select>
            </label>
            <label>Expiration Date<input name="expirationDate" type="date" defaultValue={yyyyMmDd(expiringSoon)} /></label>
            <details className="card detail-card">
              <summary><strong>Recommended Maintenance</strong><span className="badge">{maintenanceItems.length}</span></summary>
              <div className="checkbox-grid" style={{ marginTop: 12 }}>
                {maintenanceItems.map((item) => (
                  <label className="checkbox-row" key={item.id}>
                    <input type="checkbox" name="maintenanceIds" value={item.id} />
                    {item.vehicle.customer.name} · {item.vehicle.year} {item.vehicle.make} {item.vehicle.model} · {item.name} · {money.format(item.averagePrice)}
                  </label>
                ))}
              </div>
            </details>
            <details className="card detail-card">
              <summary><strong>Service Library</strong><span className="badge">{services.length}</span></summary>
              <div className="checkbox-grid" style={{ marginTop: 12 }}>
                {services.map((service) => (
                  <label className="checkbox-row" key={service.id}>
                    <input type="checkbox" name="serviceIds" value={service.id} />
                    {service.name} · {money.format(service.averagePrice)}
                  </label>
                ))}
              </div>
            </details>
            <div className="form-row">
              <label>Labor<input name="laborDescription" placeholder="Diagnostic labor" /></label>
              <label>Hours<input name="laborHours" type="number" min={0} step="0.1" defaultValue={1} /></label>
            </div>
            <label>Labor Rate<input name="laborRate" type="number" min={0} step="0.01" defaultValue={125} /></label>
            <div className="form-row">
              <label>Part<input name="partDescription" placeholder="Cabin air filter" /></label>
              <label>Qty<input name="partQuantity" type="number" min={0} step="0.1" defaultValue={1} /></label>
            </div>
            <label>Part Price<input name="partPrice" type="number" min={0} step="0.01" /></label>
            <details className="card detail-card">
              <summary><strong>Extra line items</strong><span className="badge">Labor, parts, fees</span></summary>
              {[0, 1, 2].map((index) => (
                <div className="grid" style={{ marginTop: 12 }} key={index}>
                  <label>Type
                    <select name="lineType" defaultValue={index === 0 ? "LABOR" : index === 1 ? "PART" : "FEE"}>
                      <option>SERVICE</option>
                      <option>LABOR</option>
                      <option>PART</option>
                      <option>FEE</option>
                      <option>DISCOUNT</option>
                    </select>
                  </label>
                  <label>Description<input name="lineDescription" placeholder={index === 0 ? "Inspection labor" : index === 1 ? "Brake pads" : "Hazardous waste fee"} /></label>
                  <div className="form-row">
                    <label>Quantity<input name="lineQuantity" type="number" min={0} step="0.1" defaultValue={1} /></label>
                    <label>Unit Price<input name="lineUnitPrice" type="number" min={0} step="0.01" /></label>
                  </div>
                </div>
              ))}
            </details>
            <div className="form-row">
              <label>Shop Fee<input name="shopFee" type="number" min={0} step="0.01" /></label>
              <label>Tax %<input name="taxRate" type="number" min={0} step="0.01" /></label>
            </div>
            <label>Discount<input name="discountAmount" type="number" min={0} step="0.01" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button className="button" type="submit"><Plus /> Generate Quote</button>
          </form>

          <div className="panel">
            <h2>Reporting</h2>
            <div className="list" style={{ marginTop: 12 }}>
              <div className="bar-row"><div className="mini-row"><span>Created</span><strong>{quotes.length}</strong></div><div className="bar-track"><span style={{ width: "100%" }} /></div></div>
              <div className="bar-row"><div className="mini-row"><span>Approved</span><strong>{approved.length}</strong></div><div className="bar-track ok"><span style={{ width: `${quotes.length ? Math.round((approved.length / quotes.length) * 100) : 0}%` }} /></div></div>
              <div className="bar-row"><div className="mini-row"><span>Declined</span><strong>{quotes.filter((quote) => quote.status === "DECLINED").length}</strong></div><div className="bar-track danger"><span style={{ width: `${quotes.length ? Math.round((quotes.filter((quote) => quote.status === "DECLINED").length / quotes.length) * 100) : 0}%` }} /></div></div>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
