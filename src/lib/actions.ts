"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, currentUser, hashPassword, requireUser, signOut, verifyPassword } from "@/lib/auth";
import { databaseErrorMessage, isDatabaseError } from "@/lib/db-errors";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

function stringValue(formData: FormData, key: string, fallback = "") {
  return String(formData.get(key) ?? fallback).trim();
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumberValue(formData: FormData, key: string) {
  const raw = stringValue(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function dateValue(formData: FormData, key: string, fallback = new Date()) {
  const raw = stringValue(formData, key);
  return raw ? new Date(raw) : fallback;
}

function optionalDateValue(formData: FormData, key: string) {
  const raw = stringValue(formData, key);
  return raw ? new Date(raw) : null;
}

function stringValues(formData: FormData, key: string) {
  return formData.getAll(key).map((value) => String(value)).filter(Boolean);
}

function returnTo(formData: FormData, fallback: string) {
  const value = stringValue(formData, "returnTo", fallback);
  return value.startsWith("/app") ? value : fallback;
}

function failWithMessage(formData: FormData, fallback: string, message: string): never {
  redirect(`${returnTo(formData, fallback)}?error=${encodeURIComponent(message)}`);
}

function requiredMileage(formData: FormData, key = "mileage") {
  const raw = stringValue(formData, key);
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

async function validateMileageForVehicle(vehicleId: string, mileage: number, confirmLower: boolean) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  const currentMileage = vehicle?.currentMileage ?? 0;
  if (mileage < currentMileage && !confirmLower) {
    return `Mileage ${mileage.toLocaleString()} is lower than the current mileage ${currentMileage.toLocaleString()}. Check "Confirm lower mileage" if this is a correction.`;
  }
  return null;
}

async function syncVehicleMileageProfile(vehicleId: string) {
  const logs = await prisma.mileageLog.findMany({
    where: { vehicleId },
    orderBy: { loggedAt: "asc" }
  });
  if (!logs.length) return;

  const usableLogs = logs.filter((log) => !log.source.toLowerCase().includes("correction"));
  const profileLogs = usableLogs.length >= 2 ? usableLogs : logs;
  const first = profileLogs[0];
  const last = profileLogs[profileLogs.length - 1];
  let estimatedMilesYear: number | undefined;
  if (first && last && profileLogs.length >= 2) {
    const days = Math.max(1, (last.loggedAt.getTime() - first.loggedAt.getTime()) / 86400000);
    const annual = Math.round(((last.mileage - first.mileage) / days) * 365);
    if (annual > 0) estimatedMilesYear = annual;
  }

  const highest = logs.reduce((max, log) => Math.max(max, log.mileage), 0);
  const latest = [...logs].sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime())[0];
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      currentMileage: highest,
      mileageUpdatedAt: latest.loggedAt,
      ...(estimatedMilesYear ? { estimatedMilesYear } : {})
    }
  });
}

function vehicleDashboardPath(customerId: string, vehicleId: string) {
  return `/app/customers/${customerId}/vehicles/${vehicleId}`;
}

async function recordMileage(params: {
  vehicleId: string;
  mileage: number;
  loggedAt: Date;
  source: string;
  previousCurrentMileage: number;
  allowLowerCurrent?: boolean;
}) {
  const source = params.allowLowerCurrent && params.mileage < params.previousCurrentMileage
    ? `Correction: ${params.source}`
    : params.source;
  const dayStart = new Date(params.loggedAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const duplicate = await prisma.mileageLog.findFirst({
    where: {
      vehicleId: params.vehicleId,
      mileage: params.mileage,
      source,
      loggedAt: { gte: dayStart, lt: dayEnd }
    }
  });
  if (!duplicate) {
    await prisma.mileageLog.create({
      data: {
        vehicleId: params.vehicleId,
        mileage: params.mileage,
        loggedAt: params.loggedAt,
        source
      }
    });
  }
  await syncVehicleMileageProfile(params.vehicleId);
}

export async function loginAction(formData: FormData) {
  const email = stringValue(formData, "email").toLowerCase();
  const password = stringValue(formData, "password");
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      redirect("/login?error=Invalid%20email%20or%20password");
    }
    await createSession(user.id);
  } catch (error) {
    if (isDatabaseError(error)) {
      redirect(`/login?error=${encodeURIComponent(databaseErrorMessage(error))}`);
    }
    throw error;
  }
  redirect("/app");
}

export async function signupAction(formData: FormData) {
  const shopName = stringValue(formData, "shopName");
  const name = stringValue(formData, "name");
  const email = stringValue(formData, "email").toLowerCase();
  const password = stringValue(formData, "password");
  const plan = stringValue(formData, "plan", "Starter");
  const slug = shopName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 44);

  const passwordHash = await hashPassword(password);
  const shop = await prisma.shop.create({
    data: {
      name: shopName,
      slug: `${slug}-${Math.random().toString(36).slice(2, 6)}`,
      plan,
      bookingLink: "",
      users: { create: { name, email, passwordHash, role: "OWNER" } },
      services: {
        create: defaultServices()
      },
      reminderRules: {
        create: [
          { serviceName: "Oil change", thresholdPercentage: 20 },
          { serviceName: "Tire rotation", thresholdPercentage: 15 },
          { serviceName: "Brake inspection", thresholdPercentage: 10 },
          { serviceName: "Overdue service", thresholdPercentage: 0 }
        ]
      }
    },
    include: { users: true }
  });
  await prisma.shop.update({ where: { id: shop.id }, data: { bookingLink: `/booking/${shop.slug}` } });
  const services = await prisma.service.findMany({ where: { shopId: shop.id } });
  const byName = new Map(services.map((service) => [service.name, service]));
  const basic = await prisma.servicePackage.create({
    data: {
      shopId: shop.id,
      name: "Basic Maintenance Package",
      description: "Oil change, tire rotation, and brake inspection."
    }
  });
  const major = await prisma.servicePackage.create({
    data: {
      shopId: shop.id,
      name: "Major Service Package",
      description: "Core long-term maintenance services for higher-value follow-up."
    }
  });
  await prisma.servicePackageItem.createMany({
    data: [
      ...["Oil change", "Tire rotation", "Brake inspection"]
        .map((name) => byName.get(name))
        .filter(Boolean)
        .map((service) => ({ packageId: basic.id, serviceId: service!.id })),
      ...["Oil change", "Coolant flush", "Transmission service", "Spark plugs"]
        .map((name) => byName.get(name))
        .filter(Boolean)
        .map((service) => ({ packageId: major.id, serviceId: service!.id }))
    ]
  });
  await createSession(shop.users[0].id);
  redirect("/app");
}

export async function logoutAction() {
  await signOut();
}

export async function createCustomerAction(formData: FormData) {
  const user = await requireUser();
  await prisma.customer.create({
    data: {
      shopId: user.shopId,
      name: stringValue(formData, "name"),
      phone: stringValue(formData, "phone"),
      email: stringValue(formData, "email") || null,
      notes: stringValue(formData, "notes") || null,
      communicationPrefs: stringValue(formData, "communicationPrefs", "SMS")
    }
  });
  revalidatePath("/app/customers");
}

export async function createCustomerWithVehicleAction(formData: FormData) {
  const user = await requireUser();
  const currentMileage = requiredMileage(formData, "currentMileage");
  if (currentMileage === null) failWithMessage(formData, "/app/customers/new", "Vehicle mileage is required and cannot be negative.");
  const customer = await prisma.customer.create({
    data: {
      shopId: user.shopId,
      name: stringValue(formData, "name"),
      phone: stringValue(formData, "phone"),
      email: stringValue(formData, "email") || null,
      notes: stringValue(formData, "notes") || null,
      communicationPrefs: stringValue(formData, "communicationPrefs", "SMS"),
      vehicles: {
        create: {
          year: numberValue(formData, "year", new Date().getFullYear()),
          make: stringValue(formData, "make"),
          model: stringValue(formData, "model"),
          trim: stringValue(formData, "trim") || null,
          vin: stringValue(formData, "vin") || null,
          licensePlate: stringValue(formData, "licensePlate") || null,
          vehicleType: stringValue(formData, "vehicleType") || null,
          currentMileage,
          mileageUpdatedAt: new Date(),
          estimatedMilesYear: numberValue(formData, "estimatedMilesYear", 12000),
          mileageLogs: { create: { mileage: currentMileage, loggedAt: new Date(), source: "onboarding" } }
        }
      }
    },
    include: { vehicles: true }
  });
  const vehicle = customer.vehicles[0];
  const services = await prisma.service.findMany({ where: { shopId: user.shopId, status: "ACTIVE" } });
  if (vehicle && services.length) {
    await prisma.maintenanceItem.createMany({
      data: services.map((service) => ({
        vehicleId: vehicle.id,
        serviceId: service.id,
        name: service.name,
        lastCompletedDate: new Date(),
        lastCompletedMileage: currentMileage,
        mileageInterval: service.defaultMileageInterval,
        timeIntervalMonths: service.defaultTimeIntervalMonths,
        averagePrice: service.averagePrice,
        reminderThresholdPercentage: service.defaultReminderThreshold
      }))
    });
  }
  revalidatePath("/app/customers");
  revalidatePath("/app/maintenance");
  redirect(`/app/customers/${customer.id}`);
}

export async function updateCustomerAction(formData: FormData) {
  const user = await requireUser();
  const customerId = stringValue(formData, "customerId");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId: user.shopId } });
  if (!customer) return;
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      name: stringValue(formData, "name"),
      phone: stringValue(formData, "phone"),
      email: stringValue(formData, "email") || null,
      communicationPrefs: stringValue(formData, "communicationPrefs", "SMS"),
      notes: stringValue(formData, "notes") || null
    }
  });
  revalidatePath("/app/customers");
  revalidatePath(`/app/customers/${customerId}`);
}

export async function deleteCustomerAction(formData: FormData) {
  const user = await requireUser();
  const customerId = stringValue(formData, "customerId");
  const confirmed = formData.get("confirmDelete") === "on";
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, shopId: user.shopId },
    include: { vehicles: { include: { serviceRecords: true } } }
  });
  if (!customer) return;
  if (!confirmed && customer.vehicles.length) {
    failWithMessage(
      formData,
      `/app/customers/${customerId}`,
      `Deleting ${customer.name} will also delete ${customer.vehicles.length} vehicle profile(s) and ${customer.vehicles.reduce((sum, vehicle) => sum + vehicle.serviceRecords.length, 0)} service record(s). Confirm the delete first.`
    );
  }
  await prisma.customer.delete({ where: { id: customerId } });
  revalidatePath("/app/customers");
  redirect("/app/customers");
}

export async function createVehicleAction(formData: FormData) {
  const user = await requireUser();
  const customerId = stringValue(formData, "customerId");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId: user.shopId } });
  if (!customer) return;
  const currentMileage = requiredMileage(formData, "currentMileage");
  if (currentMileage === null) failWithMessage(formData, `/app/customers/${customerId}`, "Vehicle mileage is required and cannot be negative.");
  const vehicle = await prisma.vehicle.create({
    data: {
      customerId,
      year: numberValue(formData, "year", new Date().getFullYear()),
      make: stringValue(formData, "make"),
      model: stringValue(formData, "model"),
      trim: stringValue(formData, "trim") || null,
      vehicleType: stringValue(formData, "vehicleType") || null,
      vin: stringValue(formData, "vin") || null,
      licensePlate: stringValue(formData, "licensePlate") || null,
      notes: stringValue(formData, "notes") || null,
      currentMileage,
      mileageUpdatedAt: new Date(),
      estimatedMilesYear: numberValue(formData, "estimatedMilesYear", 12000),
      mileageLogs: { create: { mileage: currentMileage, loggedAt: new Date(), source: "onboarding" } }
    }
  });
  const services = await prisma.service.findMany({ where: { shopId: user.shopId, status: "ACTIVE" } });
  await prisma.maintenanceItem.createMany({
    data: services.map((service) => ({
      vehicleId: vehicle.id,
      serviceId: service.id,
      name: service.name,
      lastCompletedDate: new Date(),
      lastCompletedMileage: currentMileage,
      mileageInterval: service.defaultMileageInterval,
      timeIntervalMonths: service.defaultTimeIntervalMonths,
      averagePrice: service.averagePrice,
      reminderThresholdPercentage: service.defaultReminderThreshold
    }))
  });
  revalidatePath("/app/customers");
  revalidatePath(`/app/customers/${customerId}`);
  revalidatePath("/app/maintenance");
}

export async function updateVehicleAction(formData: FormData) {
  const user = await requireUser();
  const vehicleId = stringValue(formData, "vehicleId");
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, customer: { shopId: user.shopId } },
    include: { customer: true }
  });
  if (!vehicle) return;
  const fallback = returnTo(formData, `/app/customers/${vehicle.customerId}`);
  const rawMileage = stringValue(formData, "currentMileage");
  const mileage = rawMileage ? requiredMileage(formData, "currentMileage") : null;
  if (rawMileage && mileage === null) failWithMessage(formData, fallback, "Vehicle mileage is required and cannot be negative.");
  const mileageError = mileage !== null
    ? await validateMileageForVehicle(vehicle.id, mileage, formData.get("confirmLowerMileage") === "on")
    : null;
  if (mileageError) failWithMessage(formData, fallback, mileageError);
  await prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      year: numberValue(formData, "year", vehicle.year),
      make: stringValue(formData, "make"),
      model: stringValue(formData, "model"),
      trim: stringValue(formData, "trim") || null,
      vehicleType: stringValue(formData, "vehicleType") || null,
      vin: stringValue(formData, "vin") || null,
      licensePlate: stringValue(formData, "licensePlate") || null,
      notes: stringValue(formData, "notes") || null,
      estimatedMilesYear: numberValue(formData, "estimatedMilesYear", vehicle.estimatedMilesYear)
    }
  });
  if (mileage !== null) {
    await recordMileage({
      vehicleId: vehicle.id,
      mileage,
      loggedAt: new Date(),
      source: "vehicle edit",
      previousCurrentMileage: vehicle.currentMileage,
      allowLowerCurrent: formData.get("confirmLowerMileage") === "on"
    });
  }
  revalidatePath("/app/customers");
  revalidatePath(`/app/customers/${vehicle.customerId}`);
  revalidatePath(vehicleDashboardPath(vehicle.customerId, vehicle.id));
  revalidatePath("/app/maintenance");
}

export async function deleteVehicleAction(formData: FormData) {
  const user = await requireUser();
  const vehicleId = stringValue(formData, "vehicleId");
  const confirmed = formData.get("confirmDelete") === "on";
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, customer: { shopId: user.shopId } },
    include: { customer: true, serviceRecords: true }
  });
  if (!vehicle) return;
  if (!confirmed && vehicle.serviceRecords.length) {
    failWithMessage(
      formData,
      `/app/customers/${vehicle.customerId}`,
      `Deleting this vehicle will also delete ${vehicle.serviceRecords.length} service record(s). Confirm the delete first.`
    );
  }
  await prisma.vehicle.delete({ where: { id: vehicle.id } });
  revalidatePath("/app/customers");
  revalidatePath(`/app/customers/${vehicle.customerId}`);
  revalidatePath("/app/maintenance");
}

export async function addMileageAction(formData: FormData) {
  const user = await requireUser();
  const vehicleId = stringValue(formData, "vehicleId");
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, customer: { shopId: user.shopId } },
    include: { mileageLogs: true }
  });
  if (!vehicle) return;
  const mileage = requiredMileage(formData);
  const fallback = vehicleDashboardPath(vehicle.customerId, vehicle.id);
  if (mileage === null) failWithMessage(formData, fallback, "Mileage is required and cannot be negative.");
  const mileageError = await validateMileageForVehicle(vehicleId, mileage, formData.get("confirmLowerMileage") === "on");
  if (mileageError) failWithMessage(formData, fallback, mileageError);
  await recordMileage({
    vehicleId,
    mileage,
    loggedAt: dateValue(formData, "loggedAt"),
    source: stringValue(formData, "source", "service"),
    previousCurrentMileage: vehicle.currentMileage,
    allowLowerCurrent: formData.get("confirmLowerMileage") === "on"
  });
  revalidatePath(fallback);
  revalidatePath(`/app/customers/${vehicle.customerId}`);
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
  revalidatePath("/app/customers");
}

export async function updateMileageLogAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "mileageLogId");
  const log = await prisma.mileageLog.findFirst({
    where: { id, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!log) return;
  const fallback = vehicleDashboardPath(log.vehicle.customerId, log.vehicleId);
  const mileage = requiredMileage(formData);
  if (mileage === null) failWithMessage(formData, fallback, "Mileage is required and cannot be negative.");
  const mileageError = await validateMileageForVehicle(log.vehicleId, mileage, formData.get("confirmLowerMileage") === "on");
  if (mileageError) failWithMessage(formData, fallback, mileageError);
  const source = stringValue(formData, "source", log.source);
  await prisma.mileageLog.update({
    where: { id },
    data: {
      mileage,
      loggedAt: dateValue(formData, "loggedAt", log.loggedAt),
      source: formData.get("confirmLowerMileage") === "on" && mileage < log.vehicle.currentMileage && !source.toLowerCase().includes("correction")
        ? `Correction: ${source}`
        : source
    }
  });
  await syncVehicleMileageProfile(log.vehicleId);
  revalidatePath(fallback);
  revalidatePath(`/app/customers/${log.vehicle.customerId}`);
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
}

export async function deleteMileageLogAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "mileageLogId");
  const log = await prisma.mileageLog.findFirst({
    where: { id, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!log) return;
  const fallback = vehicleDashboardPath(log.vehicle.customerId, log.vehicleId);
  await prisma.mileageLog.delete({ where: { id } });
  await syncVehicleMileageProfile(log.vehicleId);
  revalidatePath(fallback);
  revalidatePath(`/app/customers/${log.vehicle.customerId}`);
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
}

export async function flagMileageCorrectionAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "mileageLogId");
  const log = await prisma.mileageLog.findFirst({
    where: { id, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!log) return;
  const fallback = vehicleDashboardPath(log.vehicle.customerId, log.vehicleId);
  await prisma.mileageLog.update({
    where: { id },
    data: { source: log.source.toLowerCase().includes("correction") ? log.source : `Correction: ${log.source}` }
  });
  await syncVehicleMileageProfile(log.vehicleId);
  revalidatePath(fallback);
  revalidatePath(`/app/customers/${log.vehicle.customerId}`);
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
}

export async function completeServiceAction(formData: FormData) {
  const user = await requireUser();
  const maintenanceId = stringValue(formData, "maintenanceId");
  const item = await prisma.maintenanceItem.findFirst({
    where: { id: maintenanceId, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!item) return;
  const mileage = requiredMileage(formData);
  if (mileage === null) failWithMessage(formData, "/app/maintenance", "Completion mileage is required and cannot be negative.");
  const mileageError = await validateMileageForVehicle(item.vehicleId, mileage, formData.get("confirmLowerMileage") === "on");
  if (mileageError) failWithMessage(formData, "/app/maintenance", mileageError);
  const serviceDate = dateValue(formData, "serviceDate");
  const record = await prisma.serviceRecord.create({
    data: {
      shopId: user.shopId,
      customerId: item.vehicle.customerId,
      vehicleId: item.vehicleId,
      technicianId: stringValue(formData, "technicianId") || null,
      serviceDate,
      mileage,
      summary: stringValue(formData, "summary", `${item.name} completed`),
      notes: stringValue(formData, "notes") || null,
      revenue: numberValue(formData, "revenue", item.averagePrice)
    }
  });
  await prisma.customer.update({
    where: { id: item.vehicle.customerId },
    data: { lifetimeSpend: { increment: numberValue(formData, "revenue", item.averagePrice) } }
  });
  await prisma.maintenanceItem.update({
    where: { id: item.id },
    data: {
      lastCompletedDate: serviceDate,
      lastCompletedMileage: mileage,
      status: "ACTIVE",
      overrideDueDate: null,
      overrideDueMileage: null
    }
  });
  await recordMileage({
    vehicleId: item.vehicleId,
    mileage,
    loggedAt: serviceDate,
    source: "completed service",
    previousCurrentMileage: item.vehicle.currentMileage,
    allowLowerCurrent: formData.get("confirmLowerMileage") === "on"
  });

  const deferredDescription = stringValue(formData, "deferredDescription");
  if (deferredDescription) {
    await prisma.deferredOpportunity.create({
      data: {
        shopId: user.shopId,
        vehicleId: item.vehicleId,
        serviceRecordId: record.id,
        description: deferredDescription,
        estimatedRevenue: numberValue(formData, "deferredRevenue", 0),
        followUpDate: dateValue(formData, "followUpDate", new Date(Date.now() + 30 * 86400000))
      }
    });
  }
  revalidatePath("/app/maintenance");
  revalidatePath("/app/customers");
  revalidatePath("/app/forecast");
  revalidatePath(vehicleDashboardPath(item.vehicle.customerId, item.vehicleId));
}

export async function updateMaintenanceItemAction(formData: FormData) {
  const user = await requireUser();
  const maintenanceId = stringValue(formData, "maintenanceId");
  const item = await prisma.maintenanceItem.findFirst({
    where: { id: maintenanceId, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!item) return;
  const fallback = returnTo(formData, "/app/maintenance");
  const mileageInterval = requiredMileage(formData, "mileageInterval");
  if (mileageInterval === null || mileageInterval <= 0) failWithMessage(formData, fallback, "Mileage interval must be greater than zero.");
  const dueMileage = optionalNumberValue(formData, "overrideDueMileage");
  if (dueMileage !== null && dueMileage < item.vehicle.currentMileage && formData.get("confirmLowerMileage") !== "on") {
    failWithMessage(formData, fallback, `Due mileage ${dueMileage.toLocaleString()} is below the vehicle's current mileage ${item.vehicle.currentMileage.toLocaleString()}. Confirm lower mileage if this is intentional.`);
  }
  await prisma.maintenanceItem.update({
    where: { id: item.id },
    data: {
      name: stringValue(formData, "name"),
      mileageInterval,
      timeIntervalMonths: Math.max(1, numberValue(formData, "timeIntervalMonths", item.timeIntervalMonths)),
      averagePrice: Math.max(0, numberValue(formData, "averagePrice", item.averagePrice)),
      status: stringValue(formData, "status", "ACTIVE"),
      overrideDueMileage: dueMileage,
      overrideDueDate: optionalDateValue(formData, "overrideDueDate"),
      remindersEnabled: formData.get("remindersEnabled") === "on",
      reminderThresholdPercentage: Math.max(0, Math.min(100, numberValue(formData, "reminderThresholdPercentage", item.reminderThresholdPercentage))),
      customNotes: stringValue(formData, "customNotes") || null
    }
  });
  revalidatePath("/app/maintenance");
  revalidatePath("/app/customers");
  revalidatePath(vehicleDashboardPath(item.vehicle.customerId, item.vehicleId));
  revalidatePath(fallback);
}

export async function createMaintenanceItemAction(formData: FormData) {
  const user = await requireUser();
  const vehicleId = stringValue(formData, "vehicleId");
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, customer: { shopId: user.shopId } }
  });
  if (!vehicle) return;
  const fallback = returnTo(formData, "/app/maintenance");
  const serviceId = stringValue(formData, "serviceId") || null;
  const service = serviceId ? await prisma.service.findFirst({ where: { id: serviceId, shopId: user.shopId } }) : null;
  const mileageInterval = requiredMileage(formData, "mileageInterval") ?? service?.defaultMileageInterval ?? null;
  if (mileageInterval === null || mileageInterval <= 0) failWithMessage(formData, fallback, "Mileage interval must be greater than zero.");
  const timeIntervalMonths = optionalNumberValue(formData, "timeIntervalMonths") ?? service?.defaultTimeIntervalMonths ?? 6;
  const averagePrice = optionalNumberValue(formData, "averagePrice") ?? service?.averagePrice ?? 0;
  const reminderThreshold = optionalNumberValue(formData, "reminderThresholdPercentage") ?? service?.defaultReminderThreshold ?? 20;
  const existing = service ? await prisma.maintenanceItem.findFirst({ where: { vehicleId, serviceId: service.id } }) : null;
  if (existing && service) failWithMessage(formData, fallback, `${service.name} is already assigned to this vehicle.`);
  await prisma.maintenanceItem.create({
    data: {
      vehicleId,
      serviceId: service?.id ?? null,
      name: service?.name ?? stringValue(formData, "name"),
      lastCompletedDate: dateValue(formData, "lastCompletedDate", new Date()),
      lastCompletedMileage: numberValue(formData, "lastCompletedMileage", vehicle.currentMileage),
      mileageInterval,
      timeIntervalMonths: Math.max(1, timeIntervalMonths),
      averagePrice: Math.max(0, averagePrice),
      reminderThresholdPercentage: Math.max(0, Math.min(100, reminderThreshold)),
      remindersEnabled: formData.get("remindersEnabled") === "on",
      status: stringValue(formData, "status", "ACTIVE")
    }
  });
  revalidatePath("/app/maintenance");
  revalidatePath("/app/customers");
  revalidatePath(vehicleDashboardPath(vehicle.customerId, vehicle.id));
  revalidatePath(fallback);
}

export async function deleteMaintenanceItemAction(formData: FormData) {
  const user = await requireUser();
  const maintenanceId = stringValue(formData, "maintenanceId");
  const item = await prisma.maintenanceItem.findFirst({
    where: { id: maintenanceId, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!item) return;
  const fallback = returnTo(formData, "/app/maintenance");
  await prisma.maintenanceItem.delete({ where: { id: item.id } });
  revalidatePath("/app/maintenance");
  revalidatePath("/app/customers");
  revalidatePath(vehicleDashboardPath(item.vehicle.customerId, item.vehicleId));
  revalidatePath(fallback);
}

export async function createServiceRecordAction(formData: FormData) {
  const user = await requireUser();
  const vehicleId = stringValue(formData, "vehicleId");
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, customer: { shopId: user.shopId } },
    include: { customer: true }
  });
  if (!vehicle) return;
  const fallback = returnTo(formData, `/app/customers/${vehicle.customerId}`);
  const mileage = requiredMileage(formData);
  if (mileage === null) failWithMessage(formData, fallback, "Service mileage is required and cannot be negative.");
  const mileageError = await validateMileageForVehicle(vehicleId, mileage, formData.get("confirmLowerMileage") === "on");
  if (mileageError) failWithMessage(formData, fallback, mileageError);
  const serviceDate = dateValue(formData, "serviceDate");
  const revenue = numberValue(formData, "revenue", 0);
  const record = await prisma.serviceRecord.create({
    data: {
      shopId: user.shopId,
      customerId: vehicle.customerId,
      vehicleId,
      technicianId: stringValue(formData, "technicianId") || null,
      serviceDate,
      mileage,
      summary: stringValue(formData, "summary"),
      notes: stringValue(formData, "notes") || null,
      revenue,
      nextRecommendedService: stringValue(formData, "nextRecommendedService") || null,
      nextRecommendedMileage: optionalNumberValue(formData, "nextRecommendedMileage")
    }
  });
  await prisma.customer.update({
    where: { id: vehicle.customerId },
    data: { lifetimeSpend: { increment: revenue } }
  });
  const barcode = stringValue(formData, "inventoryBarcode");
  const quantityUsed = numberValue(formData, "inventoryQuantityUsed", 0);
  if (barcode && quantityUsed > 0) {
    const item = await prisma.inventoryItem.findFirst({ where: { shopId: user.shopId, barcode } });
    if (item) {
      await prisma.inventoryScanLog.create({
        data: {
          shopId: user.shopId,
          inventoryItemId: item.id,
          serviceRecordId: record.id,
          quantityUsed,
          barcode,
          scannedBy: user.name
        }
      });
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { quantityOnHand: Math.max(0, item.quantityOnHand - quantityUsed) }
      });
    }
  }
  await recordMileage({
    vehicleId,
    mileage,
    loggedAt: serviceDate,
    source: "service record",
    previousCurrentMileage: vehicle.currentMileage,
    allowLowerCurrent: formData.get("confirmLowerMileage") === "on"
  });
  revalidatePath(`/app/customers/${vehicle.customerId}`);
  revalidatePath(vehicleDashboardPath(vehicle.customerId, vehicleId));
  revalidatePath("/app/customers");
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
}

export async function updateServiceRecordAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "serviceRecordId");
  const record = await prisma.serviceRecord.findFirst({
    where: { id, shopId: user.shopId },
    include: { vehicle: true }
  });
  if (!record) return;
  const mileage = requiredMileage(formData);
  if (mileage === null) failWithMessage(formData, `/app/customers/${record.vehicle.customerId}`, "Service mileage is required and cannot be negative.");
  const mileageError = await validateMileageForVehicle(record.vehicleId, mileage, formData.get("confirmLowerMileage") === "on");
  if (mileageError) failWithMessage(formData, `/app/customers/${record.vehicle.customerId}`, mileageError);
  const newRevenue = numberValue(formData, "revenue", record.revenue);
  await prisma.serviceRecord.update({
    where: { id },
    data: {
      serviceDate: dateValue(formData, "serviceDate", record.serviceDate),
      mileage,
      summary: stringValue(formData, "summary", record.summary),
      notes: stringValue(formData, "notes") || null,
      revenue: newRevenue,
      technicianId: stringValue(formData, "technicianId") || null,
      nextRecommendedService: stringValue(formData, "nextRecommendedService") || null,
      nextRecommendedMileage: optionalNumberValue(formData, "nextRecommendedMileage")
    }
  });
  if (record.customerId) {
    await prisma.customer.update({
      where: { id: record.customerId },
      data: { lifetimeSpend: { increment: newRevenue - record.revenue } }
    });
  }
  await recordMileage({
    vehicleId: record.vehicleId,
    mileage,
    loggedAt: dateValue(formData, "serviceDate", record.serviceDate),
    source: "service record edit",
    previousCurrentMileage: record.vehicle.currentMileage,
    allowLowerCurrent: formData.get("confirmLowerMileage") === "on"
  });
  revalidatePath(`/app/customers/${record.vehicle.customerId}`);
  revalidatePath(vehicleDashboardPath(record.vehicle.customerId, record.vehicleId));
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
}

export async function deleteServiceRecordAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "serviceRecordId");
  const record = await prisma.serviceRecord.findFirst({
    where: { id, shopId: user.shopId },
    include: { vehicle: true }
  });
  if (!record) return;
  await prisma.serviceRecord.delete({ where: { id } });
  if (record.customerId) {
    await prisma.customer.update({
      where: { id: record.customerId },
      data: { lifetimeSpend: { decrement: record.revenue } }
    });
  }
  revalidatePath(`/app/customers/${record.vehicle.customerId}`);
  revalidatePath("/app/forecast");
}

export async function createAppointmentAction(formData: FormData) {
  const user = await requireUser();
  await createAppointmentForShop(user.shopId, formData);
  revalidatePath("/app/calendar");
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
  revalidatePath("/app");
}

export async function moveAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId } });
  if (!appointment) return;
  await prisma.appointment.update({
    where: { id },
    data: {
      scheduledAt: dateValue(formData, "scheduledAt", appointment.scheduledAt),
      technicianId: stringValue(formData, "technicianId") || null,
      status: stringValue(formData, "status", appointment.status)
    }
  });
  revalidatePath("/app/calendar");
  revalidatePath("/app");
}

export async function updateAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId } });
  if (!appointment) return;
  const vehicleId = stringValue(formData, "vehicleId", appointment.vehicleId);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, customer: { shopId: user.shopId } } });
  await prisma.appointment.update({
    where: { id },
    data: {
      customerId: vehicle?.customerId ?? appointment.customerId,
      vehicleId,
      technicianId: stringValue(formData, "technicianId") || null,
      scheduledAt: dateValue(formData, "scheduledAt", appointment.scheduledAt),
      durationMinutes: Math.max(15, numberValue(formData, "durationMinutes", appointment.durationMinutes)),
      status: stringValue(formData, "status", appointment.status),
      serviceName: stringValue(formData, "serviceName", appointment.serviceName),
      estimatedRevenue: Math.max(0, numberValue(formData, "estimatedRevenue", appointment.estimatedRevenue)),
      notes: stringValue(formData, "notes") || null
    }
  });
  revalidatePath("/app/calendar");
  revalidatePath("/app");
}

export async function deleteAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId } });
  if (!appointment) return;
  await prisma.appointment.delete({ where: { id } });
  revalidatePath("/app/calendar");
  revalidatePath("/app");
}

export async function createPublicBookingAction(slug: string, formData: FormData) {
  const shop = await prisma.shop.findUnique({ where: { slug } });
  if (!shop) return;
  const customerEmail = stringValue(formData, "email") || null;
  const phone = stringValue(formData, "phone");
  const customer =
    (await prisma.customer.findFirst({
      where: {
        shopId: shop.id,
        OR: [
          { phone },
          ...(customerEmail ? [{ email: customerEmail }] : [])
        ]
      }
    })) ??
    (await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: stringValue(formData, "name"),
        phone,
        email: customerEmail,
        communicationPrefs: "SMS"
      }
    }));
  const mileage = numberValue(formData, "currentMileage", 0);
  const existingVehicle = await prisma.vehicle.findFirst({
    where: {
      customerId: customer.id,
      year: numberValue(formData, "year", new Date().getFullYear()),
      make: stringValue(formData, "make"),
      model: stringValue(formData, "model")
    }
  });
  const vehicle = existingVehicle ?? await prisma.vehicle.create({
    data: {
      customerId: customer.id,
      year: numberValue(formData, "year", new Date().getFullYear()),
      make: stringValue(formData, "make"),
      model: stringValue(formData, "model"),
      vehicleType: stringValue(formData, "vehicleType") || null,
      currentMileage: mileage,
      mileageUpdatedAt: new Date(),
      mileageLogs: { create: { mileage, source: "booking" } }
    }
  });
  if (existingVehicle && mileage > existingVehicle.currentMileage) {
    await recordMileage({
      vehicleId: existingVehicle.id,
      mileage,
      loggedAt: new Date(),
      source: "booking",
      previousCurrentMileage: existingVehicle.currentMileage
    });
  }
  await prisma.appointment.create({
    data: {
      shopId: shop.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      scheduledAt: dateValue(formData, "scheduledAt"),
      serviceName: stringValue(formData, "serviceName"),
      estimatedRevenue: numberValue(formData, "estimatedRevenue", 120),
      durationMinutes: numberValue(formData, "durationMinutes", 60)
    }
  });
  redirect(`/booking/${slug}?booked=1`);
}

async function createAppointmentForShop(shopId: string, formData: FormData) {
  const customerId = stringValue(formData, "customerId");
  const vehicleId = stringValue(formData, "vehicleId");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId } });
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, customer: { shopId } } });
  if (!customer || !vehicle) return;
  await prisma.appointment.create({
    data: {
      shopId,
      customerId,
      vehicleId,
      technicianId: stringValue(formData, "technicianId") || null,
      scheduledAt: dateValue(formData, "scheduledAt"),
      durationMinutes: numberValue(formData, "durationMinutes", 60),
      serviceName: stringValue(formData, "serviceName"),
      estimatedRevenue: numberValue(formData, "estimatedRevenue", 0),
      estimatedJobHours: numberValue(formData, "estimatedJobHours", 1),
      notes: stringValue(formData, "notes") || null
    }
  });
}

export async function updateReminderRuleAction(formData: FormData) {
  const user = await requireUser();
  await prisma.reminderRule.upsert({
    where: { id: stringValue(formData, "id") || "new" },
    update: {
      serviceName: stringValue(formData, "serviceName"),
      thresholdPercentage: numberValue(formData, "thresholdPercentage", 20),
      enabled: formData.get("enabled") === "on",
      messageTemplate: stringValue(formData, "messageTemplate") || null
    },
    create: {
      shopId: user.shopId,
      serviceName: stringValue(formData, "serviceName"),
      thresholdPercentage: numberValue(formData, "thresholdPercentage", 20),
      enabled: formData.get("enabled") === "on",
      messageTemplate: stringValue(formData, "messageTemplate") || null
    }
  }).catch(async () => {
    await prisma.reminderRule.create({
      data: {
        shopId: user.shopId,
        serviceName: stringValue(formData, "serviceName"),
        thresholdPercentage: numberValue(formData, "thresholdPercentage", 20),
        enabled: formData.get("enabled") === "on",
        messageTemplate: stringValue(formData, "messageTemplate") || null
      }
    });
  });
  revalidatePath("/app/reminders");
}

export async function sendMockReminderAction(formData: FormData) {
  const user = await requireUser();
  const item = await prisma.maintenanceItem.findFirst({
    where: { id: stringValue(formData, "maintenanceId"), vehicle: { customer: { shopId: user.shopId } } },
    include: {
      vehicle: {
        include: {
          customer: true,
          mileageLogs: true
        }
      }
    }
  });
  if (!item) return;
  const prediction = maintenancePrediction(item as MaintenanceWithVehicle);
  const rule = await prisma.reminderRule.findFirst({ where: { shopId: user.shopId, serviceName: item.name, enabled: true } });
  const template = rule?.messageTemplate || "Hi {customer}, your {vehicle} is coming due for {service}. You can book here: {bookingLink}";
  const message = template
    .replaceAll("{customer}", item.vehicle.customer.name)
    .replaceAll("{vehicle}", `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`)
    .replaceAll("{service}", item.name)
    .replaceAll("{bookingLink}", user.shop.bookingLink || `/booking/${user.shop.slug}`);
  await prisma.reminderLog.create({
    data: {
      maintenanceItemId: item.id,
      customerId: item.vehicle.customerId,
      vehicleId: item.vehicleId,
      customerName: item.vehicle.customer.name,
      phone: item.vehicle.customer.phone,
      message: `${message} Estimated due: ${prediction.dueDate.toLocaleDateString()}.`,
      status: process.env.SMS_API_KEY ? "SENT" : "MOCK_SENT"
    }
  });
  revalidatePath("/app/maintenance");
  revalidatePath("/app/reminders");
}

export async function skipReminderAction(formData: FormData) {
  const user = await requireUser();
  const item = await prisma.maintenanceItem.findFirst({
    where: { id: stringValue(formData, "maintenanceId"), vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: { include: { customer: true } } }
  });
  if (!item) return;
  await prisma.reminderLog.create({
    data: {
      maintenanceItemId: item.id,
      customerId: item.vehicle.customerId,
      vehicleId: item.vehicleId,
      customerName: item.vehicle.customer.name,
      phone: item.vehicle.customer.phone,
      message: `Skipped ${item.name} reminder`,
      status: "SKIPPED"
    }
  });
  revalidatePath("/app/reminders");
}

export async function createInventoryItemAction(formData: FormData) {
  const user = await requireUser();
  await prisma.inventoryItem.create({
    data: {
      shopId: user.shopId,
      sku: stringValue(formData, "sku"),
      barcode: stringValue(formData, "barcode"),
      name: stringValue(formData, "name"),
      category: stringValue(formData, "category"),
      quantityOnHand: numberValue(formData, "quantityOnHand", 0),
      unitType: stringValue(formData, "unitType", "each"),
      reorderThreshold: numberValue(formData, "reorderThreshold", 0),
      cost: numberValue(formData, "cost", 0),
      supplier: stringValue(formData, "supplier")
    }
  });
  revalidatePath("/app/inventory");
}

export async function scanInventoryAction(formData: FormData) {
  const user = await requireUser();
  const barcode = stringValue(formData, "barcode");
  const quantityUsed = numberValue(formData, "quantityUsed", 1);
  const item = await prisma.inventoryItem.findFirst({ where: { shopId: user.shopId, barcode } });
  if (!item) return;
  await prisma.inventoryScanLog.create({
    data: {
      shopId: user.shopId,
      inventoryItemId: item.id,
      serviceRecordId: stringValue(formData, "serviceRecordId") || null,
      quantityUsed,
      barcode,
      scannedBy: user.name
    }
  });
  await prisma.inventoryItem.update({
    where: { id: item.id },
    data: { quantityOnHand: Math.max(0, item.quantityOnHand - quantityUsed) }
  });
  revalidatePath("/app/inventory");
  revalidatePath("/app");
}

export async function createTechnicianAction(formData: FormData) {
  const user = await requireUser();
  await prisma.technician.create({
    data: {
      shopId: user.shopId,
      name: stringValue(formData, "name"),
      role: stringValue(formData, "role", "Technician"),
      hourlyRate: numberValue(formData, "hourlyRate", 0)
    }
  });
  revalidatePath("/app/team");
}

export async function createServiceLibraryAction(formData: FormData) {
  const user = await requireUser();
  await prisma.service.create({
    data: {
      shopId: user.shopId,
      name: stringValue(formData, "name"),
      category: stringValue(formData, "category", "Custom"),
      defaultMileageInterval: Math.max(1, numberValue(formData, "defaultMileageInterval", 5000)),
      defaultTimeIntervalMonths: Math.max(1, numberValue(formData, "defaultTimeIntervalMonths", 6)),
      averagePrice: Math.max(0, numberValue(formData, "averagePrice", 0)),
      defaultReminderThreshold: Math.max(0, Math.min(100, numberValue(formData, "defaultReminderThreshold", 20))),
      description: stringValue(formData, "description") || null,
      recommendedNotes: stringValue(formData, "recommendedNotes") || null,
      status: stringValue(formData, "status", "ACTIVE")
    }
  });
  revalidatePath("/app/settings/service-library");
}

export async function updateServiceLibraryAction(formData: FormData) {
  const user = await requireUser();
  const serviceId = stringValue(formData, "serviceId");
  const service = await prisma.service.findFirst({ where: { id: serviceId, shopId: user.shopId } });
  if (!service) return;
  await prisma.service.update({
    where: { id: service.id },
    data: {
      name: stringValue(formData, "name"),
      category: stringValue(formData, "category", "Custom"),
      defaultMileageInterval: Math.max(1, numberValue(formData, "defaultMileageInterval", service.defaultMileageInterval)),
      defaultTimeIntervalMonths: Math.max(1, numberValue(formData, "defaultTimeIntervalMonths", service.defaultTimeIntervalMonths)),
      averagePrice: Math.max(0, numberValue(formData, "averagePrice", service.averagePrice)),
      defaultReminderThreshold: Math.max(0, Math.min(100, numberValue(formData, "defaultReminderThreshold", service.defaultReminderThreshold))),
      description: stringValue(formData, "description") || null,
      recommendedNotes: stringValue(formData, "recommendedNotes") || null,
      status: stringValue(formData, "status", service.status)
    }
  });
  revalidatePath("/app/settings/service-library");
  revalidatePath("/app/maintenance");
  revalidatePath("/app");
}

export async function duplicateServiceLibraryAction(formData: FormData) {
  const user = await requireUser();
  const service = await prisma.service.findFirst({ where: { id: stringValue(formData, "serviceId"), shopId: user.shopId } });
  if (!service) return;
  await prisma.service.create({
    data: {
      shopId: user.shopId,
      name: `${service.name} Copy`,
      category: service.category,
      defaultMileageInterval: service.defaultMileageInterval,
      defaultTimeIntervalMonths: service.defaultTimeIntervalMonths,
      averagePrice: service.averagePrice,
      defaultReminderThreshold: service.defaultReminderThreshold,
      description: service.description,
      recommendedNotes: service.recommendedNotes,
      status: service.status
    }
  });
  revalidatePath("/app/settings/service-library");
}

export async function archiveServiceLibraryAction(formData: FormData) {
  const user = await requireUser();
  const service = await prisma.service.findFirst({ where: { id: stringValue(formData, "serviceId"), shopId: user.shopId } });
  if (!service) return;
  await prisma.service.update({
    where: { id: service.id },
    data: { status: service.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }
  });
  revalidatePath("/app/settings/service-library");
}

export async function deleteServiceLibraryAction(formData: FormData) {
  const user = await requireUser();
  const serviceId = stringValue(formData, "serviceId");
  const service = await prisma.service.findFirst({
    where: { id: serviceId, shopId: user.shopId },
    include: { maintenanceItems: true }
  });
  if (!service) return;
  if (service.maintenanceItems.length && formData.get("confirmDelete") !== "on") {
    failWithMessage(formData, "/app/settings/service-library", `This service is currently assigned to ${service.maintenanceItems.length} vehicle(s). Confirm delete first.`);
  }
  await prisma.service.delete({ where: { id: service.id } });
  revalidatePath("/app/settings/service-library");
  revalidatePath("/app/maintenance");
}

export async function createServicePackageAction(formData: FormData) {
  const user = await requireUser();
  const serviceIds = stringValues(formData, "serviceIds");
  await prisma.servicePackage.create({
    data: {
      shopId: user.shopId,
      name: stringValue(formData, "name"),
      description: stringValue(formData, "description") || null,
      status: stringValue(formData, "status", "ACTIVE"),
      items: {
        create: serviceIds.map((serviceId) => ({ serviceId }))
      }
    }
  });
  revalidatePath("/app/settings/service-library");
}

export async function updateServicePackageAction(formData: FormData) {
  const user = await requireUser();
  const packageId = stringValue(formData, "packageId");
  const servicePackage = await prisma.servicePackage.findFirst({ where: { id: packageId, shopId: user.shopId } });
  if (!servicePackage) return;
  const serviceIds = stringValues(formData, "serviceIds");
  await prisma.servicePackage.update({
    where: { id: servicePackage.id },
    data: {
      name: stringValue(formData, "name"),
      description: stringValue(formData, "description") || null,
      status: stringValue(formData, "status", servicePackage.status),
      items: {
        deleteMany: {},
        create: serviceIds.map((serviceId) => ({ serviceId }))
      }
    }
  });
  revalidatePath("/app/settings/service-library");
}

export async function deleteServicePackageAction(formData: FormData) {
  const user = await requireUser();
  const servicePackage = await prisma.servicePackage.findFirst({ where: { id: stringValue(formData, "packageId"), shopId: user.shopId } });
  if (!servicePackage) return;
  await prisma.servicePackage.delete({ where: { id: servicePackage.id } });
  revalidatePath("/app/settings/service-library");
}

async function assignServicesToVehicle(params: {
  shopId: string;
  vehicleId: string;
  serviceIds: string[];
  fallback: string;
}) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: params.vehicleId, customer: { shopId: params.shopId } } });
  if (!vehicle) return;
  const services = await prisma.service.findMany({
    where: { id: { in: params.serviceIds }, shopId: params.shopId, status: "ACTIVE" }
  });
  const existing = await prisma.maintenanceItem.findMany({
    where: { vehicleId: vehicle.id, serviceId: { in: services.map((service) => service.id) } },
    select: { serviceId: true }
  });
  const existingIds = new Set(existing.map((item) => item.serviceId).filter(Boolean));
  const toCreate = services.filter((service) => !existingIds.has(service.id));
  if (!toCreate.length) return;
  await prisma.maintenanceItem.createMany({
    data: toCreate.map((service) => ({
      vehicleId: vehicle.id,
      serviceId: service.id,
      name: service.name,
      lastCompletedDate: new Date(),
      lastCompletedMileage: vehicle.currentMileage,
      mileageInterval: service.defaultMileageInterval,
      timeIntervalMonths: service.defaultTimeIntervalMonths,
      averagePrice: service.averagePrice,
      reminderThresholdPercentage: service.defaultReminderThreshold,
      status: "ACTIVE",
      remindersEnabled: true
    }))
  });
  revalidatePath(params.fallback);
  revalidatePath(vehicleDashboardPath(vehicle.customerId, vehicle.id));
  revalidatePath("/app/maintenance");
  revalidatePath("/app");
}

export async function applyServicePackageAction(formData: FormData) {
  const user = await requireUser();
  const packageId = stringValue(formData, "packageId");
  const servicePackage = await prisma.servicePackage.findFirst({
    where: { id: packageId, shopId: user.shopId, status: "ACTIVE" },
    include: { items: true }
  });
  if (!servicePackage) return;
  await assignServicesToVehicle({
    shopId: user.shopId,
    vehicleId: stringValue(formData, "vehicleId"),
    serviceIds: servicePackage.items.map((item) => item.serviceId),
    fallback: returnTo(formData, "/app/customers")
  });
}

export async function applyRecommendedServicesAction(formData: FormData) {
  const user = await requireUser();
  await assignServicesToVehicle({
    shopId: user.shopId,
    vehicleId: stringValue(formData, "vehicleId"),
    serviceIds: stringValues(formData, "serviceIds"),
    fallback: returnTo(formData, "/app/customers")
  });
}

export async function updateShopAction(formData: FormData) {
  const user = await requireUser();
  await prisma.shop.update({
    where: { id: user.shopId },
    data: {
      name: stringValue(formData, "name"),
      plan: stringValue(formData, "plan"),
      bookingLink: stringValue(formData, "bookingLink")
    }
  });
  revalidatePath("/app/settings");
}

export async function inviteUserAction(formData: FormData) {
  const user = await requireUser();
  const existing = await prisma.user.findUnique({ where: { email: stringValue(formData, "email").toLowerCase() } });
  if (existing) return;
  await prisma.user.create({
    data: {
      shopId: user.shopId,
      name: stringValue(formData, "name"),
      email: stringValue(formData, "email").toLowerCase(),
      passwordHash: await hashPassword(stringValue(formData, "password", "password123")),
      role: stringValue(formData, "role", "MECHANIC")
    }
  });
  revalidatePath("/app/settings");
}

export async function ensureDemoLogin() {
  const user = await currentUser();
  if (user) redirect("/app");
}

function defaultServices() {
  return [
    { name: "Oil change", category: "Fluids", defaultMileageInterval: 5000, defaultTimeIntervalMonths: 6, averagePrice: 90, defaultReminderThreshold: 20, description: "Standard engine oil and filter service." },
    { name: "Tire rotation", category: "Inspection", defaultMileageInterval: 6000, defaultTimeIntervalMonths: 6, averagePrice: 65, defaultReminderThreshold: 15, description: "Rotate tires and inspect tread wear." },
    { name: "Brake inspection", category: "Brakes", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 120, defaultReminderThreshold: 10, description: "Inspect pads, rotors, calipers, and brake fluid condition." },
    { name: "Transmission service", category: "Fluids", defaultMileageInterval: 60000, defaultTimeIntervalMonths: 48, averagePrice: 320, defaultReminderThreshold: 15, description: "Transmission fluid and service inspection." },
    { name: "Coolant flush", category: "Cooling System", defaultMileageInterval: 30000, defaultTimeIntervalMonths: 36, averagePrice: 180, defaultReminderThreshold: 15, description: "Cooling system flush and refill." },
    { name: "Spark plugs", category: "Engine", defaultMileageInterval: 90000, defaultTimeIntervalMonths: 72, averagePrice: 420, defaultReminderThreshold: 10, description: "Replace spark plugs and inspect ignition components." },
    { name: "Air filter", category: "Filters", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20, description: "Replace engine air filter." },
    { name: "Cabin filter", category: "Filters", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20, description: "Replace cabin air filter." },
    { name: "Battery inspection", category: "Electrical", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 40, defaultReminderThreshold: 10, description: "Test battery, charging, and starting system." }
  ];
}
