import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, CheckCircle2, Copy, Mail, MessageSquareText, XCircle } from "lucide-react";
import { convertQuoteToAppointmentAction, duplicateQuoteAction, sendQuoteAction, updateQuoteStatusAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { dateLabel, dateTimeInputValue, money } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { PrintQuoteButton } from "../print-button";

function statusTone(status: string) {
  if (status === "APPROVED") return "ok";
  if (status === "DECLINED" || status === "EXPIRED") return "danger";
  if (status === "SENT") return "warn";
  return "";
}

function shareUrl(token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` || "http://localhost:3000";
  return `${base}/quote/${token}`;
}

export default async function QuoteDetailPage({ params }: { params: { quoteId: string } }) {
  const user = await requireUser();
  const quote = await prisma.quote.findFirst({
    where: { id: params.quoteId, shopId: user.shopId },
    include: {
      customer: true,
      vehicle: true,
      serviceRecord: true,
      lines: { orderBy: { createdAt: "asc" } }
    }
  });
  if (!quote) notFound();
  const publicUrl = shareUrl(quote.shareToken);
  const displayStatus = quote.expirationDate < new Date() && quote.status !== "APPROVED" && quote.status !== "DECLINED" ? "EXPIRED" : quote.status;

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Quote detail</p>
          <h1>{quote.quoteNumber}</h1>
          <p>{quote.customer.name} · {quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model} · expires {dateLabel(quote.expirationDate)}</p>
        </div>
        <div className="row">
          <Link className="button secondary" href="/app/quotes"><ArrowLeft /> Quotes</Link>
          <PrintQuoteButton />
        </div>
      </header>

      <section className="grid grid-5">
        <div className="card stat"><span className="muted">Status</span><strong>{displayStatus}</strong><span className={`badge ${statusTone(displayStatus)}`}>Quote</span></div>
        <div className="card stat"><span className="muted">Total</span><strong>{money.format(quote.total)}</strong><span className="badge warn">Customer value</span></div>
        <div className="card stat"><span className="muted">Subtotal</span><strong>{money.format(quote.subtotal)}</strong></div>
        <div className="card stat"><span className="muted">Tax</span><strong>{money.format(quote.taxTotal)}</strong></div>
        <div className="card stat"><span className="muted">Discounts</span><strong>{money.format(quote.discountTotal)}</strong></div>
      </section>

      <section className="split" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="row">
            <h2>Estimate</h2>
            <span className={`badge ${statusTone(displayStatus)}`}>{displayStatus}</span>
          </div>
          <div className="quote-paper">
            <div className="row">
              <div>
                <strong>{user.shop.name}</strong>
                <p>{user.shop.slug}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <strong>{quote.quoteNumber}</strong>
                <p>{dateLabel(quote.issueDate)} · expires {dateLabel(quote.expirationDate)}</p>
              </div>
            </div>
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <div className="card"><strong>Customer</strong><p>{quote.customer.name}<br />{quote.customer.phone}<br />{quote.customer.email ?? "No email"}</p></div>
              <div className="card"><strong>Vehicle</strong><p>{quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}<br />VIN {quote.vehicle.vin ?? "not set"}<br />Plate {quote.vehicle.licensePlate ?? "not set"}</p></div>
            </div>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Type</th><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
                <tbody>
                  {quote.lines.map((line) => (
                    <tr key={line.id}>
                      <td><span className="badge">{line.lineType}</span></td>
                      <td>{line.description}</td>
                      <td>{line.quantity}</td>
                      <td>{money.format(line.unitPrice)}</td>
                      <td>{money.format(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="quote-totals">
              <div className="mini-row"><span>Subtotal</span><strong>{money.format(quote.subtotal)}</strong></div>
              <div className="mini-row"><span>Discounts</span><strong>-{money.format(quote.discountTotal)}</strong></div>
              <div className="mini-row"><span>Tax</span><strong>{money.format(quote.taxTotal)}</strong></div>
              <div className="mini-row quote-total"><span>Total</span><strong>{money.format(quote.total)}</strong></div>
            </div>
            {quote.notes ? <p style={{ marginTop: 16 }}>{quote.notes}</p> : null}
          </div>
        </div>

        <aside className="grid">
          <div className="panel">
            <h2>Quote Actions</h2>
            <div className="grid">
              <form action={sendQuoteAction}><input type="hidden" name="quoteId" value={quote.id} /><button className="button secondary" type="submit"><Mail /> Email</button></form>
              <form action={sendQuoteAction}><input type="hidden" name="quoteId" value={quote.id} /><button className="button secondary" type="submit"><MessageSquareText /> SMS</button></form>
              <form action={duplicateQuoteAction}><input type="hidden" name="quoteId" value={quote.id} /><button className="button secondary" type="submit"><Copy /> Duplicate</button></form>
              <form action={updateQuoteStatusAction}><input type="hidden" name="quoteId" value={quote.id} /><input type="hidden" name="status" value="APPROVED" /><button className="button secondary" type="submit"><CheckCircle2 /> Mark Approved</button></form>
              <form action={updateQuoteStatusAction}><input type="hidden" name="quoteId" value={quote.id} /><input type="hidden" name="status" value="DECLINED" /><button className="button secondary" type="submit"><XCircle /> Mark Declined</button></form>
            </div>
          </div>

          <form className="panel form" action={convertQuoteToAppointmentAction}>
            <h2>Convert to Appointment</h2>
            <input type="hidden" name="quoteId" value={quote.id} />
            <label>Scheduled time<input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInputValue(new Date(Date.now() + 86400000))} /></label>
            <label>Duration minutes<input name="durationMinutes" type="number" min={15} defaultValue={120} /></label>
            <button className="button" type="submit"><CalendarPlus /> Convert to Appointment</button>
          </form>

          <div className="panel">
            <h2>Approval Link</h2>
            <p className="break-word">{publicUrl}</p>
            <Link className="button secondary" href={`/quote/${quote.shareToken}`}>Open customer portal</Link>
          </div>
        </aside>
      </section>
    </>
  );
}
