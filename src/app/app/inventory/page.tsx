import { Barcode, PackagePlus } from "lucide-react";
import { createInventoryItemAction, scanInventoryAction } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inventoryRunout } from "@/lib/predictions";
import { money } from "@/lib/format";

export default async function InventoryPage() {
  const user = await requireUser();
  const [items, serviceRecords] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { shopId: user.shopId }, include: { scanLogs: true }, orderBy: { quantityOnHand: "asc" } }),
    prisma.serviceRecord.findMany({ where: { shopId: user.shopId }, include: { vehicle: { include: { customer: true } } }, orderBy: { serviceDate: "desc" }, take: 20 })
  ]);
  const fastest = [...items].sort((a, b) => inventoryRunout(b).monthlyUsage - inventoryRunout(a).monthlyUsage).slice(0, 5);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Parts and supplies</p>
          <h1>Inventory</h1>
          <p>Scan or manually enter barcodes, attach usage to service records, and spot low-stock runout risk.</p>
        </div>
      </header>
      <section className="split">
        <div className="panel">
          <h2>Inventory Intelligence</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th>On hand</th><th>Monthly usage</th><th>Runout</th><th>Suggested reorder</th><th>Cost</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const runout = inventoryRunout(item);
                  return (
                    <tr key={item.id}>
                      <td><strong>{item.name}</strong><br /><span className="muted">{item.sku} · {item.barcode}</span></td>
                      <td><span className={item.quantityOnHand <= item.reorderThreshold ? "badge danger" : "badge ok"}>{item.quantityOnHand} {item.unitType}</span></td>
                      <td>{runout.monthlyUsage} {item.unitType}</td>
                      <td>{runout.runoutDays === null ? "No trend" : `${runout.runoutDays} days`}</td>
                      <td>{runout.suggestedReorderQuantity} {item.unitType}</td>
                      <td>{money.format(item.cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="grid">
          <form className="panel form" action={scanInventoryAction}>
            <h2>Barcode Scan</h2>
            <label>Barcode<input name="barcode" placeholder="850001111001" required /></label>
            <label>Quantity used<input name="quantityUsed" type="number" step="0.1" defaultValue={1} /></label>
            <label>Attach to service record
              <select name="serviceRecordId">
                <option value="">None</option>
                {serviceRecords.map((record) => <option key={record.id} value={record.id}>{record.vehicle.customer.name} · {record.summary}</option>)}
              </select>
            </label>
            <button className="button" type="submit"><Barcode /> Log scan</button>
          </form>
          <form className="panel form" action={createInventoryItemAction}>
            <h2>Add Item</h2>
            <div className="form-row"><label>SKU<input name="sku" required /></label><label>Barcode<input name="barcode" required /></label></div>
            <label>Name<input name="name" required /></label>
            <div className="form-row"><label>Category<input name="category" /></label><label>Unit<input name="unitType" defaultValue="each" /></label></div>
            <div className="form-row"><label>On hand<input name="quantityOnHand" type="number" step="0.1" /></label><label>Reorder at<input name="reorderThreshold" type="number" step="0.1" /></label></div>
            <div className="form-row"><label>Cost<input name="cost" type="number" step="0.01" /></label><label>Supplier<input name="supplier" /></label></div>
            <button className="button secondary" type="submit"><PackagePlus /> Add item</button>
          </form>
          <div className="panel">
            <h2>Fastest Moving</h2>
            <div className="list">
              {fastest.map((item) => <div className="card row" key={item.id}><strong>{item.name}</strong><span className="badge">{inventoryRunout(item).monthlyUsage}/mo</span></div>)}
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}
