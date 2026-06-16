import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

export type MaintenanceQueueSource = MaintenanceWithVehicle & {
  reminders?: { status: string; sentAt: Date }[];
};

export type MaintenanceQueueRow = {
  item: MaintenanceQueueSource;
  prediction: ReturnType<typeof maintenancePrediction>;
};

function statusRank(status: string) {
  if (status === "Overdue") return 0;
  if (status === "Due") return 1;
  if (status === "Due Soon") return 2;
  return 3;
}

function compareRows(a: MaintenanceQueueRow, b: MaintenanceQueueRow) {
  return (
    statusRank(a.prediction.status) - statusRank(b.prediction.status) ||
    a.prediction.remainingLifePercentage - b.prediction.remainingLifePercentage ||
    b.item.averagePrice - a.item.averagePrice
  );
}

export function isOpenMaintenanceOpportunity(row: MaintenanceQueueRow) {
  return row.prediction.status === "Overdue" || row.prediction.status === "Due" || row.prediction.status === "Due Soon";
}

export function buildMaintenanceQueue(maintenance: MaintenanceQueueSource[], asOf = new Date()) {
  const rows = maintenance
    .map((item) => ({ item, prediction: maintenancePrediction(item, asOf) }))
    .sort(compareRows);
  const cards = Array.from(new Map(rows.map((row) => [row.item.vehicleId, row.item.vehicle])).values())
    .map((vehicle) => {
      const vehicleRows = rows.filter((row) => row.item.vehicleId === vehicle.id).sort(compareRows);
      const opportunityRows = vehicleRows.filter(isOpenMaintenanceOpportunity);
      const overdueCount = vehicleRows.filter((row) => row.prediction.status === "Overdue").length;
      const dueCount = vehicleRows.filter((row) => row.prediction.status === "Due").length;
      const dueSoonCount = vehicleRows.filter((row) => row.prediction.status === "Due Soon").length;
      const healthyCount = vehicleRows.filter((row) => row.prediction.status === "Healthy").length;
      const potentialRevenue = opportunityRows.reduce((sum, row) => sum + row.item.averagePrice, 0);
      const healthScore = vehicleRows.length
        ? Math.round(vehicleRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / vehicleRows.length)
        : 100;
      const latestReminder = vehicleRows
        .flatMap((row) => row.item.reminders ?? [])
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0] ?? null;

      return {
        vehicle,
        customer: vehicle.customer,
        rows: vehicleRows,
        opportunityRows,
        highestPriority: opportunityRows[0] ?? vehicleRows[0] ?? null,
        overdueCount,
        dueCount,
        dueSoonCount,
        healthyCount,
        potentialRevenue,
        healthScore,
        lowestLife: vehicleRows[0]?.prediction.remainingLifePercentage ?? 100,
        latestReminder
      };
    })
    .filter((card) => card.opportunityRows.length > 0)
    .sort((a, b) =>
      b.overdueCount - a.overdueCount ||
      b.potentialRevenue - a.potentialRevenue ||
      b.dueSoonCount - a.dueSoonCount ||
      a.lowestLife - b.lowestLife
    );

  const overdueRevenue = rows
    .filter((row) => row.prediction.status === "Overdue")
    .reduce((sum, row) => sum + row.item.averagePrice, 0);
  const dueSoonRevenue = rows
    .filter((row) => row.prediction.status === "Due" || row.prediction.status === "Due Soon")
    .reduce((sum, row) => sum + row.item.averagePrice, 0);

  return {
    rows,
    opportunityRows: rows.filter(isOpenMaintenanceOpportunity),
    cards,
    kpis: {
      overdueRevenue,
      dueSoonRevenue,
      openOpportunities: overdueRevenue + dueSoonRevenue,
      vehiclesDue: cards.length,
      customersReady: new Set(cards.map((card) => card.customer.id)).size
    }
  };
}
