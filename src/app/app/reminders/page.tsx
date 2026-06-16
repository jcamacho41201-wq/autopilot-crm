import { Save, Send } from "lucide-react";
import { sendMockReminderAction, skipReminderAction, updateReminderRuleAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";
import { dateLabel } from "@/lib/format";

export default async function RemindersPage() {
  const user = await requireUser();
  const [rules, maintenance, logs] = await Promise.all([
    prisma.reminderRule.findMany({ where: { shopId: user.shopId }, orderBy: { serviceName: "asc" } }),
    prisma.maintenanceItem.findMany({
      where: { remindersEnabled: true, vehicle: { customer: { shopId: user.shopId } } },
      include: { vehicle: { include: { customer: true, mileageLogs: true } } }
    }),
    prisma.reminderLog.findMany({
      where: { maintenanceItem: { vehicle: { customer: { shopId: user.shopId } } } },
      orderBy: { sentAt: "desc" },
      take: 12
    })
  ]);
  const due = (maintenance as MaintenanceWithVehicle[])
    .map((item) => ({ item, prediction: maintenancePrediction(item) }))
    .filter(({ prediction }) => prediction.shouldRemind || prediction.isOverdue)
    .sort((a, b) => a.prediction.dueDate.getTime() - b.prediction.dueDate.getTime());

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Customer outreach center</p>
          <h1>Reminders</h1>
          <p>See who is ready to contact, preview the booking-link message, send now, skip, or tune service-specific rules.</p>
        </div>
      </header>
      <section className="split">
        <div className="panel">
          <h2>Ready To Remind</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Vehicle</th><th>Service</th><th>Life / Due</th><th>Message preview</th><th>Actions</th></tr></thead>
              <tbody>
                {due.map(({ item, prediction }) => (
                  <tr key={item.id}>
                    <td>{item.vehicle.customer.name}<br /><span className="muted">{item.vehicle.customer.phone}</span></td>
                    <td>{item.vehicle.year} {item.vehicle.make} {item.vehicle.model}</td>
                    <td>{item.name}</td>
                    <td><span className="badge">{prediction.remainingLifePercentage}% life</span><br /><span className={prediction.isOverdue ? "badge danger" : "badge warn"}>{prediction.isOverdue ? "Overdue" : dateLabel(prediction.dueDate)}</span></td>
                    <td>Hi {item.vehicle.customer.name}, your {item.vehicle.year} {item.vehicle.make} {item.vehicle.model} is approaching its next {item.name}. Book here: {user.shop.bookingLink}</td>
                    <td>
                      <form action={sendMockReminderAction}>
                        <input type="hidden" name="maintenanceId" value={item.id} />
                        <button className="icon-button" title="Send mock reminder" type="submit"><Send /></button>
                      </form>
                      <form action={skipReminderAction} style={{ marginTop: 8 }}>
                        <input type="hidden" name="maintenanceId" value={item.id} />
                        <button className="button ghost" type="submit">Skip</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="grid">
          <div className="panel">
            <h2>Rules</h2>
            <div className="list">
              {rules.map((rule) => (
                <form className="card form" action={updateReminderRuleAction} key={rule.id}>
                  <input type="hidden" name="id" value={rule.id} />
                  <label>Service<input name="serviceName" defaultValue={rule.serviceName} /></label>
                  <label>Threshold %<input name="thresholdPercentage" type="number" defaultValue={rule.thresholdPercentage} /></label>
                  <label>Message template<textarea name="messageTemplate" defaultValue={rule.messageTemplate ?? "Hi {customer}, your {vehicle} is coming due for {service}. You can book here: {bookingLink}"} /></label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: 18 }} name="enabled" type="checkbox" defaultChecked={rule.enabled} /> Enabled</label>
                  <button className="button secondary" type="submit"><Save /> Save</button>
                </form>
              ))}
            </div>
          </div>
          <div className="panel">
            <h2>Recent Sends</h2>
            <div className="list">
              {logs.map((log) => (
                <div className="card" key={log.id}>
                  <div className="row"><strong>{log.customerName}</strong><span className="badge">{log.status}</span></div>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
