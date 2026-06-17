import type {
  Appointment,
  Customer,
  DeferredOpportunity,
  InventoryItem,
  InventoryScanLog,
  MaintenanceItem,
  MileageLog,
  ReminderLog,
  Service,
  ServiceRecord,
  Vehicle
} from "@prisma/client";
import { getVehicleVisitAppointments, type AppointmentWithRelations } from "@/lib/appointments";
import { inventoryRunout, maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CAPACITY_MINUTES = 8 * 60;

export type DashboardAppointment = AppointmentWithRelations;

export type DashboardMaintenance = MaintenanceItem & {
  vehicle: Vehicle & {
    customer: Pick<Customer, "id" | "name" | "phone" | "email">;
    mileageLogs: MileageLog[];
    serviceRecords?: Pick<ServiceRecord, "serviceDate">[];
    appointments?: Pick<Appointment, "scheduledAt" | "status">[];
  };
  reminders?: Pick<ReminderLog, "status" | "sentAt">[];
  service?: Pick<Service, "id" | "name" | "category"> | null;
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
  priorityScore: number;
  lowestLife: number;
  priority: "red" | "yellow" | "green" | "gray";
  priorityLabel: string;
  nextDueLabel: string;
  nextBestAction: "Send Reminder" | "Book Appointment" | "View Appointment" | "Open Vehicle";
  opportunityStatus: "Needs Attention" | "Reminder Sent" | "Customer Contacted" | "Appointment Scheduled" | "Completed" | "Declined";
  opportunityDate: Date;
  primaryMaintenanceId: string | null;
  lastVisit: Date | null;
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

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function vehicleHealthScore(params: {
  vehicleRows: DashboardMaintenanceRow[];
  overdueCount: number;
  dueCount: number;
  dueSoonCount: number;
  lastVisit: Date | null;
  asOf: Date;
}) {
  const base = params.vehicleRows.length
    ? params.vehicleRows.reduce((sum, row) => sum + row.prediction.remainingLifePercentage, 0) / params.vehicleRows.length
    : 100;
  const daysSinceVisit = params.lastVisit ? Math.max(0, Math.round((params.asOf.getTime() - params.lastVisit.getTime()) / DAY_MS)) : 999;
  const historyPenalty = params.lastVisit ? 0 : 8;
  const visitPenalty = daysSinceVisit > 365 ? 18 : daysSinceVisit > 180 ? 10 : daysSinceVisit > 120 ? 5 : 0;
  return clamp(base - params.overdueCount * 12 - params.dueCount * 7 - params.dueSoonCount * 3 - historyPenalty - visitPenalty);
}

function priorityScore(params: {
  overdueCount: number;
  dueCount: number;
  dueSoonCount: number;
  opportunityValue: number;
  healthScore: number;
  latestReminder?: Pick<ReminderLog, "status" | "sentAt"> | null;
  lastVisit: Date | null;
  hasAppointment: boolean;
  asOf: Date;
}) {
  const daysSinceVisit = params.lastVisit ? Math.max(0, Math.round((params.asOf.getTime() - params.lastVisit.getTime()) / DAY_MS)) : 365;
  const revenueScore = Math.min(25, params.opportunityValue / 40);
  const maintenanceScore = Math.min(30, params.overdueCount * 12 + params.dueCount * 7 + params.dueSoonCount * 4);
  const healthScore = Math.min(18, (100 - params.healthScore) * 0.18);
  const visitScore = Math.min(12, daysSinceVisit / 30);
  const reminderScore = params.latestReminder && params.latestReminder.sentAt >= addDays(params.asOf, -14) ? 0 : 8;
  const appointmentScore = params.hasAppointment ? -12 : 7;
  return clamp(maintenanceScore + revenueScore + healthScore + visitScore + reminderScore + appointmentScore);
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
      const lowestLife = vehicleRows[0]?.prediction.remainingLifePercentage ?? 100;
      const latestReminder = vehicleRows
        .flatMap((row) => row.item.reminders ?? [])
        .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
      const lastVisit = (vehicle.serviceRecords ?? [])
        .map((record) => record.serviceDate)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const recentlyReminded = latestReminder ? latestReminder.sentAt >= addDays(asOf, -14) : false;
      const priority = overdueCount ? "red" : dueCount + dueSoonCount ? "yellow" : vehicleRows.length ? "green" : "gray";
      const primaryMaintenanceId = attentionRows[0]?.item.id ?? null;
      const hasAppointment = activeAppointmentsByVehicle.has(vehicle.id);
      const healthScore = vehicleHealthScore({ vehicleRows, overdueCount, dueCount, dueSoonCount, lastVisit, asOf });
      const customerPriority = priorityScore({ overdueCount, dueCount, dueSoonCount, opportunityValue, healthScore, latestReminder, lastVisit, hasAppointment, asOf });
      const opportunityDate = overdueCount ? asOf : attentionRows[0]?.prediction.dueDate ?? asOf;
      const opportunityStatus = hasAppointment
        ? "Appointment Scheduled"
        : latestReminder && latestReminder.status === "SKIPPED"
          ? "Customer Contacted"
          : latestReminder
            ? "Reminder Sent"
            : "Needs Attention";
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
        priorityScore: customerPriority,
        lowestLife,
        priority,
        priorityLabel: overdueCount ? "Overdue" : dueCount + dueSoonCount ? "Due soon" : vehicleRows.length ? "Healthy" : "No data",
        nextDueLabel: overdueCount ? "Overdue" : attentionRows[0] ? attentionRows[0].prediction.dueDate.toISOString() : "Healthy",
        nextBestAction,
        opportunityStatus,
        opportunityDate,
        primaryMaintenanceId,
        lastVisit
      } satisfies VehicleAttentionCard;
    })
    .filter((card) => card.attentionRows.length > 0)
    .sort((a, b) =>
      b.priorityScore - a.priorityScore ||
      b.overdueCount - a.overdueCount ||
      b.opportunityValue - a.opportunityValue ||
      b.dueSoonCount + b.dueCount - (a.dueSoonCount + a.dueCount) ||
      a.healthScore - b.healthScore
    );
}

export function getTodayShopSnapshot(appointments: DashboardAppointment[], vehicleCards: VehicleAttentionCard[], asOf = new Date()) {
  const today = startOfDay(asOf);
  const tomorrow = addDays(today, 1);
  const visits = getVehicleVisitAppointments(appointments);
  const todayAppointments = visits.filter((appointment) =>
    appointment.status === "BOOKED" && appointment.scheduledAt >= today && appointment.scheduledAt < tomorrow
  );
  const bookedMinutesToday = todayAppointments.reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
  const nextWeek = addDays(today, 7);
  const bookedMinutesNext7 = visits
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
  vehicleCards: VehicleAttentionCard[],
  opportunities: DashboardOpportunity[],
  asOf = new Date()
) {
  const next30 = addDays(asOf, 30);
  const visits = getVehicleVisitAppointments(appointments);
  const bookedRevenue = visits
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= asOf && appointment.scheduledAt <= next30)
    .reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);
  const predictedRevenue = vehicleCards
    .filter((card) => card.overdueCount === 0 && card.opportunityDate >= asOf && card.opportunityDate <= next30)
    .reduce((sum, card) => sum + card.opportunityValue, 0);
  const overdueRevenue = vehicleCards
    .filter((card) => card.overdueCount > 0)
    .reduce((sum, card) => sum + card.opportunityValue, 0);
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

export function getRevenueForecast(appointments: DashboardAppointment[], vehicleCards: VehicleAttentionCard[], asOf = new Date()) {
  const today = startOfDay(asOf);
  const visits = getVehicleVisitAppointments(appointments);
  return Array.from({ length: 13 }, (_, index) => {
    const start = addDays(today, index * 7);
    const booked = visits
      .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= today && appointment.scheduledAt <= start)
      .reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);
    const predicted = vehicleCards
      .filter((card) => card.overdueCount === 0 && card.opportunityDate >= today && card.opportunityDate <= start)
      .reduce((sum, card) => sum + card.opportunityValue, 0);
    const overdue = vehicleCards
      .filter((card) => card.overdueCount > 0)
      .reduce((sum, card) => sum + card.opportunityValue, 0);
    return {
      start,
      booked,
      predicted,
      overdue,
      total: booked + predicted + overdue
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
        const service = row.item.service?.name ?? row.item.name;
        const current = map.get(service) ?? { service, revenue: 0, vehicleIds: new Set<string>(), vehicles: [] as Array<{ id: string; customerId: string; label: string; customerName: string; status: string }> };
        current.revenue += row.item.averagePrice;
        if (!current.vehicleIds.has(row.item.vehicleId)) {
          current.vehicleIds.add(row.item.vehicleId);
          current.vehicles.push({
            id: row.item.vehicleId,
            customerId: row.item.vehicle.customer.id,
            label: `${row.item.vehicle.year} ${row.item.vehicle.make} ${row.item.vehicle.model}`,
            customerName: row.item.vehicle.customer.name,
            status: row.prediction.status
          });
        }
        map.set(service, current);
        return map;
      }, new Map<string, { service: string; revenue: number; vehicleIds: Set<string>; vehicles: Array<{ id: string; customerId: string; label: string; customerName: string; status: string }> }>())
  )
    .map(([, value]) => ({ service: value.service, revenue: value.revenue, vehicleCount: value.vehicleIds.size, vehicles: value.vehicles }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);
}

export function getCapacityForecast(appointments: DashboardAppointment[], asOf = new Date()) {
  const today = startOfDay(asOf);
  const visits = getVehicleVisitAppointments(appointments);
  return Array.from({ length: 14 }, (_, index) => {
    const start = addDays(today, index);
    const end = addDays(start, 1);
    const scheduledMinutes = visits
      .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= start && appointment.scheduledAt < end)
      .reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
    const availableMinutes = Math.max(0, DAILY_CAPACITY_MINUTES - scheduledMinutes);
    const utilization = Math.round((scheduledMinutes / DAILY_CAPACITY_MINUTES) * 100);
    return {
      date: start,
      scheduledMinutes,
      availableMinutes,
      scheduledHours: Math.round((scheduledMinutes / 60) * 10) / 10,
      availableHours: Math.round((availableMinutes / 60) * 10) / 10,
      utilization,
      tone: utilization >= 90 ? "danger" : utilization >= 70 ? "warn" : "ok"
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
