import { notFound } from "next/navigation";
import { CheckCircle2, Phone, XCircle } from "lucide-react";
import { approvePublicQuoteAction, declinePublicQuoteAction, requestQuoteCallbackAction } from "@/lib/actions";
import { dateLabel, money } from "@/lib/format";
import { prisma } from "@/lib/prisma";

function statusTone(status: string) {
  if (status === "APPROVED") return "ok";
  if (status === "DECLINED" || status === "EXPIRED") return "danger";
  if (status === "SENT") return "warn";
  return "";
}

export default async function PublicQuotePage({
  params,
  searchParams
}: {
  params: { token: string };
  searchParams: { approved?: string; declined?: string; callback?: string };
}) {
  const quote = await prisma.quote.findUnique({
    where: { shareToken: params.token },
    include: { shop: true, customer: true, vehicle: true, lines: { orderBy: { createdAt: "asc" } } }
  });
  if (!quote) notFound();
  const displayStatus = quote.expirationDate < new Date() && quote.status !== "APPROVED" && quote.status !== "DECLINED" ? "EXPIRED" : quote.status;

  return (
    <main className="public-quote-page">
      <section className="public-quote-shell">
        <div className="row">
          <div>
            <p className="eyebrow">{quote.shop.name}</p>
            <h1>{quote.quoteNumber}</h1>
            <p>{quote.customer.name} · {quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}</p>
          </div>
          <span className={`badge ${statusTone(displayStatus)}`}>{displayStatus}</span>
        </div>
        {searchParams.approved ? <p className="badge ok" style={{ marginTop: 16 }}>Quote approved. The shop can now book your appointment.</p> : null}
        {searchParams.declined ? <p className="badge danger" style={{ marginTop: 16 }}>Quote declined. The shop has been notified.</p> : null}
        {searchParams.callback ? <p className="badge warn" style={{ marginTop: 16 }}>Callback requested. The shop will contact you soon.</p> : null}

        <div className="grid grid-3" style={{ marginTop: 16 }}>
          <div className="card stat"><span className="muted">Total</span><strong>{money.format(quote.total)}</strong></div>
          <div className="card stat"><span className="muted">Issued</span><strong>{dateLabel(quote.issueDate)}</strong></div>
          <div className="card stat"><span className="muted">Expires</span><strong>{dateLabel(quote.expirationDate)}</strong></div>
        </div>

        <div className="quote-paper" style={{ marginTop: 16 }}>
          <div className="grid grid-2">
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

        <div className="quote-approval-actions">
          <form action={approvePublicQuoteAction}><input type="hidden" name="token" value={quote.shareToken} /><button className="button" type="submit"><CheckCircle2 /> Approve Quote</button></form>
          <form action={declinePublicQuoteAction}><input type="hidden" name="token" value={quote.shareToken} /><button className="button secondary" type="submit"><XCircle /> Decline</button></form>
          <form action={requestQuoteCallbackAction}><input type="hidden" name="token" value={quote.shareToken} /><button className="button secondary" type="submit"><Phone /> Request Callback</button></form>
        </div>
      </section>
    </main>
  );
}
