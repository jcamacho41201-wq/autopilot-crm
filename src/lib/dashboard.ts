import type {
  Appointment,
  Customer,
  DeferredOpportunity,
  InventoryItem,
  InventoryScanLog,
  MaintenanceItem,
  MileageLog,
  ReminderLog,
  ServiceRecord,
  Technician,
  Vehicle
} from "@prisma/client";
import { inventoryRunout, maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CAPACITY_MINUTES = 8 * 60;

export type DashboardAppointment = Appointment & {
  customer?: Customer | null;
  vehicle?: Vehicle | null;
  technician?: Technician | null;
};

export type DashboardMaintenance = MaintenanceItem & {
  vehicle: Vehicle & {
    customer: Pick<Customer, "id" | "name" | "phone" | "email">;
    mileageLogs: MileageLog[];
  };
  reminders?: Pick<ReminderLog, "status" | "sentAt">[];
};

export type DashboardOpportunity = DeferredOpportunity & {
  vehicle?: (Vehicle & { customer?: Customer | null }) | null;
};

export type DashboardInventoryItem = InventoryItem & {
  scanLogs?: InventoryScanLog[];
};

export type DashboardCustomer = Customer & {
  serviceRecords?: Pick<ServiceRecord, "serviceDate">[];
  appointments?: Pick<Appointment, "scheduledAt" | "status">[];
};

export type DashboardMaintenanceRow = {
  item: DashboardMaintenance;
  prediction: ReturnType<typeof maintenancePrediction>;
};

export type VehicleAttentionCard = {
  vehicle: DashboardMaintenance["vehicle"];
  customer: DashboardMaintenance["vehicle"]["customer"];
  rows: DashboardMaintenanceRow[];
  attentionRows: DashboardMaintenanceRow[];
  overdueCount: number;
  dueCount: number;
  dueSoonCount: number;
  healthyCount: number;
  opportunityValue: number;
  healthScore: number;
  lowestLife: number;
  priority: "red" | "yellow" | "green" | "gray";
  priorityLabel: string;
  nextDueLabel: string;
  nextBestAction: "Send Reminder" | "Book Appointment" | "View Appointment" | "Open Vehicle";
  primaryMaintenanceId: string | null;
};

function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function statusRank(status: string) {
  if (status === "Overdue") return 0;
  if (status === "Due") return 1;
  if (status === "Due Soon") return 2;
  if (status === "Healthy") return 3;
  return 4;
}

function compareRows(a: DashboardMaintenanceRow, b: DashboardMaintenanceRow) {
  return (
    statusRank(a.prediction.status) - statusRank(b.prediction.status) ||
    a.prediction.remainingLifePercentage - b.prediction.remainingLifePercentage ||
    b.item.averagePrice - a.item.averagePrice
  );
}

export function getMaintenanceRows(maintenance: DashboardMaintenance[], asOf = new Date()) {
  return maintenance
    .map((item) => ({
      item,
      prediction: maintenancePrediction(item as MaintenanceWithVehicle, asOf)
    }))
    .sort(compareRows);
}

export function isAttentionStatus(status: string) {
  return status === "Overdue" || status === "Due" || status === "Due Soon";
}

export function getVehiclesRequiringAttention(rows: DashboardMaintenanceRow[], appointments: DashboardAppointment[], asOf = new Date()) {
  const activeAppointmentsByVehicle = new Set(
    appointments
      .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= asOf)
      .map((appointment) => appointment.vehicleId)
  );

  return Array.from(new Map(rows.map((row) => [row.item.vehicleId, row.item.vehicle])).values())
    .map((vehicle) => {
      const vehicleRows = rows.filter((row) => row.item.vehicleId === vehicle.id).sort(compareRows);
      const attentionRows = vehicleRows.filter((row) => isAttentionStatus(row.prediction.status));
      const overdueCount = vehicleRows.filter((row) => row.prediction.status === "Overdue").length;
      const dueCount = vehicleRows.filter((row) => row.prediction.status === "Due").length;
      const dueSoonCount = vehicleRows.filter((row) => row.prediction.status === "Due Soon").length;
      const healthyCount = vehicleRows.filter((row) => row.prediction.status === "Healthy").length;
      const opportunityValue = attentionRows.reduce((sum, row) => sum + row.item.averagePrice, 0);
      const healthScore = vehicleRows.length
        ? Math.round(vehicleRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / vehicleRows.length)
        : 100;
      const lowestLife = vehicleRows[0]?.prediction.remainingLifePercentage ?? 100;
      const latestReminder = vehicleRows
        .flatMap((row) => row.item.reminders ?? [])
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
      const recentlyReminded = latestReminder ? latestReminder.sentAt >= addDays(asOf, -14) : false;
      const priority = overdueCount ? "red" : dueCount + dueSoonCount ? "yellow" : vehicleRows.length ? "green" : "gray";
      const primaryMaintenanceId = attentionRows[0]?.item.id ?? null;
      const hasAppointment = activeAppointmentsByVehicle.has(vehicle.id);
      const nextBestAction = hasAppointment
        ? "View Appointment"
        : attentionRows.length && !recentlyReminded
          ? "Send Reminder"
          : attentionRows.length
            ? "Book Appointment"
            : "Open Vehicle";

      return {
        vehicle,
        customer: vehicle.customer,
        rows: vehicleRows,
        attentionRows,
        overdueCount,
        dueCount,
        dueSoonCount,
        healthyCount,
        opportunityValue,
        healthScore,
        lowestLife,
        priority,
        priorityLabel: overdueCount ? "Overdue" : dueCount + dueSoonCount ? "Due soon" : vehicleRows.length ? "Healthy" : "No data",
        nextDueLabel: overdueCount ? "Overdue" : attentionRows[0] ? attentionRows[0].prediction.dueDate.toISOString() : "Healthy",
        nextBestAction,
        primaryMaintenanceId
      } satisfies VehicleAttentionCard;
    })
    .filter((card) => card.attentionRows.length > 0)
    .sort((a, b) =>
      b.overdueCount - a.overdueCount ||
      b.opportunityValue - a.opportunityValue ||
      b.dueSoonCount + b.dueCount - (a.dueSoonCount + a.dueCount) ||
      a.healthScore - b.healthScore
    );
}

export function getTodayShopSnapshot(appointments: DashboardAppointment[], vehicleCards: VehicleAttentionCard[], asOf = new Date()) {
  const today = startOfDay(asOf);
  const tomorrow = addDays(today, 1);
  const todayAppointments = appointments.filter((appointment) =>
    appointment.status === "BOOKED" && appointment.scheduledAt >= today && appointment.scheduledAt < tomorrow
  );
  const bookedMinutesToday = todayAppointments.reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
  const nextWeek = addDays(today, 7);
  const bookedMinutesNext7 = appointments
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= today && appointment.scheduledAt < nextWeek)
    .reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
  const capacityNext7 = DAILY_CAPACITY_MINUTES * 7;

  return {
    carsScheduledToday: todayAppointments.length,
    bookedRevenueToday: todayAppointments.reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0),
    openMinutesToday: Math.max(0, DAILY_CAPACITY_MINUTES - bookedMinutesToday),
    utilizationToday: Math.round((bookedMinutesToday / DAILY_CAPACITY_MINUTES) * 100),
    readyToRemind: vehicleCards.filter((card) => card.nextBestAction === "Send Reminder").length,
    calendarUtilization: Math.round((bookedMinutesNext7 / capacityNext7) * 100),
    bookedMinutesNext7,
    capacityNext7
  };
}

export function getRevenuePipeline(
  appointments: DashboardAppointment[],
  rows: DashboardMaintenanceRow[],
  opportunities: DashboardOpportunity[],
  asOf = new Date()
) {
  const next30 = addDays(asOf, 30);
  const bookedRevenue = appointments
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= asOf && appointment.scheduledAt <= next30)
    .reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);
  const predictedRevenue = rows
    .filter((row) => row.prediction.dueDate >= asOf && row.prediction.dueDate <= next30 && isAttentionStatus(row.prediction.status))
    .reduce((sum, row) => sum + row.item.averagePrice, 0);
  const overdueRevenue = rows
    .filter((row) => row.prediction.status === "Overdue")
    .reduce((sum, row) => sum + row.item.averagePrice, 0);
  const deferredRevenue = opportunities
    .filter((opportunity) => opportunity.status === "OPEN")
    .reduce((sum, opportunity) => sum + opportunity.estimatedRevenue, 0);

  return {
    bookedRevenue,
    predictedRevenue,
    overdueRevenue,
    deferredRevenue,
    totalOpportunity: bookedRevenue + predictedRevenue + overdueRevenue + deferredRevenue
  };
}

export function getRevenueForecast(appointments: DashboardAppointment[], rows: DashboardMaintenanceRow[], asOf = new Date()) {
  const today = startOfDay(asOf);
  return Array.from({ length: 13 }, (_, index) => {
    const start = addDays(today, index * 7);
    const end = addDays(start, 7);
    const booked = appointments
      .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= start && appointment.scheduledAt < end)
      .reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);
    const predicted = rows
      .filter((row) => isAttentionStatus(row.prediction.status) && row.prediction.dueDate >= start && row.prediction.dueDate < end)
      .reduce((sum, row) => sum + row.item.averagePrice, 0);
    return {
      start,
      booked,
      predicted,
      total: booked + predicted
    };
  });
}

export function getMaintenanceStatusBreakdown(rows: DashboardMaintenanceRow[]) {
  return {
    healthy: rows.filter((row) => row.prediction.status === "Healthy").length,
    dueSoon: rows.filter((row) => row.prediction.status === "Due" || row.prediction.status === "Due Soon").length,
    overdue: rows.filter((row) => row.prediction.status === "Overdue").length
  };
}

export function getRevenueByServiceType(rows: DashboardMaintenanceRow[]) {
  return Array.from(
    rows
      .filter((row) => isAttentionStatus(row.prediction.status))
      .reduce((map, row) => {
        const current = map.get(row.item.name) ?? 0;
        map.set(row.item.name, current + row.item.averagePrice);
        return map;
      }, new Map<string, number>())
  )
    .map(([service, revenue]) => ({ service, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
}

export function getCapacityForecast(appointments: DashboardAppointment[], asOf = new Date()) {
  const today = startOfDay(asOf);
  return Array.from({ length: 14 }, (_, index) => {
    const start = addDays(today, index);
    const end = addDays(start, 1);
    const scheduledMinutes = appointments
      .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= start && appointment.scheduledAt < end)
      .reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
    const availableMinutes = Math.max(0, DAILY_CAPACITY_MINUTES - scheduledMinutes);
    return {
      date: start,
      scheduledMinutes,
      availableMinutes,
      utilization: Math.round((scheduledMinutes / DAILY_CAPACITY_MINUTES) * 100)
    };
  });
}

export function getTopOpportunities(vehicleCards: VehicleAttentionCard[]) {
  return [...vehicleCards]
    .sort((a, b) =>
      b.opportunityValue - a.opportunityValue ||
      b.overdueCount - a.overdueCount ||
      a.healthScore - b.healthScore
    )
    .slice(0, 5);
}

export function getLowInventoryAlerts(inventory: DashboardInventoryItem[]) {
  return inventory
    .filter((item) => item.quantityOnHand <= item.reorderThreshold)
    .map((item) => ({ item, runout: inventoryRunout(item) }))
    .sort((a, b) => a.item.quantityOnHand - b.item.quantityOnHand);
}

export function getRetentionSnapshot(customers: DashboardCustomer[], vehicleCards: VehicleAttentionCard[], asOf = new Date()) {
  const sixMonthsAgo = addDays(asOf, -183);
  const twelveMonthsAgo = addDays(asOf, -365);
  const monthStart = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const overdueCustomerIds = new Set(vehicleCards.filter((card) => card.overdueCount > 0).map((card) => card.customer.id));

  const lastTouch = (customer: DashboardCustomer) => {
    const dates = [
      ...(customer.serviceRecords ?? []).map((record) => record.serviceDate),
      ...(customer.appointments ?? []).filter((appointment) => appointment.status === "BOOKED" || appointment.status === "COMPLETED").map((appointment) => appointment.scheduledAt)
    ].sort((a, b) => b.getTime() - a.getTime());
    return dates[0] ?? null;
  };

  return {
    active: customers.filter((customer) => {
      const touch = lastTouch(customer);
      return touch !== null && touch >= twelveMonthsAgo;
    }).length,
    atRisk: customers.filter((customer) => {
      const touch = lastTouch(customer);
      return (touch !== null && touch < sixMonthsAgo && touch >= twelveMonthsAgo) || overdueCustomerIds.has(customer.id);
    }).length,
    inactive: customers.filter((customer) => {
      const touch = lastTouch(customer);
      return touch === null || touch < twelveMonthsAgo;
    }).length,
    newThisMonth: customers.filter((customer) => customer.createdAt >= monthStart).length
  };
}
