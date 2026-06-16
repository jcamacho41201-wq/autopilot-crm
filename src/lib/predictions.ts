import type {
  Appointment,
  DeferredOpportunity,
  InventoryItem,
  MaintenanceItem,
  MileageLog,
  Vehicle
} from "@prisma/client";

const DEFAULT_ANNUAL_MILES = 12000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type VehicleWithLearning = Vehicle & { mileageLogs: MileageLog[] };
export type MaintenanceWithVehicle = MaintenanceItem & {
  vehicle: VehicleWithLearning & {
    customer: { name: string; phone: string; email: string | null };
  };
};

export function estimateAnnualMiles(vehicle: VehicleWithLearning) {
  const logs = [...vehicle.mileageLogs].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());
  if (logs.length < 2) return vehicle.estimatedMilesYear || DEFAULT_ANNUAL_MILES;

  const first = logs[0];
  const last = logs[logs.length - 1];
  const miles = last.mileage - first.mileage;
  const days = Math.max(1, (last.loggedAt.getTime() - first.loggedAt.getTime()) / MS_PER_DAY);
  if (miles <= 0 || days < 14) return vehicle.estimatedMilesYear || DEFAULT_ANNUAL_MILES;

  return Math.round((miles / days) * 365);
}

export function projectedMileage(vehicle: VehicleWithLearning, asOf = new Date()) {
  const annualMiles = estimateAnnualMiles(vehicle);
  const latest = [...vehicle.mileageLogs].sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime())[0];
  if (!latest) return vehicle.currentMileage;
  const elapsedDays = Math.max(0, (asOf.getTime() - latest.loggedAt.getTime()) / MS_PER_DAY);
  return Math.round(latest.mileage + (annualMiles / 365) * elapsedDays);
}

export function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export function maintenancePrediction(item: MaintenanceWithVehicle, asOf = new Date()) {
  const annualMiles = estimateAnnualMiles(item.vehicle);
  const milesPerDay = annualMiles / 365;
  const currentMileage = projectedMileage(item.vehicle, asOf);
  const dueMileage = item.lastCompletedMileage + item.mileageInterval;
  const milesUsed = Math.max(0, currentMileage - item.lastCompletedMileage);
  const mileageRemainingPct = Math.max(0, Math.min(100, ((item.mileageInterval - milesUsed) / item.mileageInterval) * 100));

  const dueByTime = addMonths(item.lastCompletedDate, item.timeIntervalMonths);
  const totalTimeDays = Math.max(1, daysBetween(item.lastCompletedDate, dueByTime));
  const elapsedTimeDays = Math.max(0, daysBetween(item.lastCompletedDate, asOf));
  const timeRemainingPct = Math.max(0, Math.min(100, ((totalTimeDays - elapsedTimeDays) / totalTimeDays) * 100));

  const daysUntilMileageDue = milesPerDay > 0 ? Math.max(0, Math.ceil((dueMileage - currentMileage) / milesPerDay)) : 365;
  const dueByMileage = new Date(asOf.getTime() + daysUntilMileageDue * MS_PER_DAY);
  const dueDate = dueByMileage < dueByTime ? dueByMileage : dueByTime;
  const remainingLifePercentage = Math.round(Math.min(mileageRemainingPct, timeRemainingPct));
  const isOverdue = dueDate <= asOf || remainingLifePercentage <= 0;
  const shouldRemind = remainingLifePercentage <= item.reminderThresholdPercentage;

  return {
    annualMiles,
    currentMileage,
    dueMileage,
    dueDate,
    remainingLifePercentage,
    mileageRemainingPct: Math.round(mileageRemainingPct),
    timeRemainingPct: Math.round(timeRemainingPct),
    isOverdue,
    shouldRemind
  };
}

export function inventoryRunout(item: InventoryItem & { scanLogs?: { quantityUsed: number; scannedAt: Date }[] }) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY);
  const monthlyUsage = (item.scanLogs ?? [])
    .filter((log) => log.scannedAt >= thirtyDaysAgo)
    .reduce((sum, log) => sum + log.quantityUsed, 0);
  const dailyUsage = monthlyUsage / 30;
  return {
    monthlyUsage,
    runoutDays: dailyUsage > 0 ? Math.floor(item.quantityOnHand / dailyUsage) : null,
    suggestedReorderQuantity: Math.max(item.reorderThreshold * 2, Math.ceil(monthlyUsage))
  };
}

export function calculateForecast(params: {
  maintenance: MaintenanceWithVehicle[];
  appointments: Appointment[];
  opportunities: DeferredOpportunity[];
  asOf?: Date;
}) {
  const asOf = params.asOf ?? new Date();
  const horizon = (days: number) => new Date(asOf.getTime() + days * MS_PER_DAY);
  const predicted = params.maintenance.map((item) => ({
    item,
    prediction: maintenancePrediction(item, asOf)
  }));

  const dueWithin = (days: number) =>
    predicted.filter(({ prediction }) => prediction.dueDate <= horizon(days));

  const bookedRevenue = params.appointments
    .filter((appointment) => appointment.status === "BOOKED" && appointment.scheduledAt >= asOf)
    .reduce((sum, appointment) => sum + appointment.estimatedRevenue, 0);

  const deferredRevenue = params.opportunities
    .filter((opportunity) => opportunity.status === "OPEN")
    .reduce((sum, opportunity) => sum + opportunity.estimatedRevenue, 0);

  const overdueRevenue = predicted
    .filter(({ prediction }) => prediction.isOverdue)
    .reduce((sum, { item }) => sum + item.averagePrice, 0);

  return {
    predicted,
    due30: dueWithin(30),
    due60: dueWithin(60),
    due90: dueWithin(90),
    bookedRevenue,
    deferredRevenue,
    overdueRevenue,
    potential30: dueWithin(30).reduce((sum, { item }) => sum + item.averagePrice, 0),
    potential60: dueWithin(60).reduce((sum, { item }) => sum + item.averagePrice, 0),
    potential90: dueWithin(90).reduce((sum, { item }) => sum + item.averagePrice, 0)
  };
}

export function utilization(appointments: Appointment[], date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const bookedMinutes = appointments
    .filter((appointment) => appointment.scheduledAt >= start && appointment.scheduledAt < end && appointment.status === "BOOKED")
    .reduce((sum, appointment) => sum + appointment.durationMinutes, 0);
  const capacityMinutes = 5 * 8 * 60;
  return Math.round((bookedMinutes / capacityMinutes) * 100);
}
