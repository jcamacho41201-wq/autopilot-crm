"use server";

import crypto from "crypto";
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
  if (!service) failWithMessage(formData, fallback, "Select a Service Library template before adding maintenance to a vehicle.");
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
  const appointment = await createAppointmentForShop(user.shopId, formData);
  revalidatePath("/app/calendar");
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
  revalidatePath("/app");
  if (appointment) revalidatePath(`/app/appointments/${appointment.id}`);
}

export async function moveAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId } });
  if (!appointment) return;
  await prisma.appointment.updateMany({
    where: {
      shopId: user.shopId,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      scheduledAt: appointment.scheduledAt
    },
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
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId }, include: { services: true } });
  if (!appointment) return;
  const vehicleId = stringValue(formData, "vehicleId", appointment.vehicleId);
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, customer: { shopId: user.shopId } } });
  const serviceName = stringValue(formData, "serviceName", appointment.serviceName);
  const estimatedRevenue = Math.max(0, numberValue(formData, "estimatedRevenue", appointment.estimatedRevenue));
  const durationMinutes = Math.max(15, numberValue(formData, "durationMinutes", appointment.durationMinutes));
  await prisma.appointment.update({
    where: { id },
    data: {
      customerId: vehicle?.customerId ?? appointment.customerId,
      vehicleId,
      technicianId: stringValue(formData, "technicianId") || null,
      scheduledAt: dateValue(formData, "scheduledAt", appointment.scheduledAt),
      durationMinutes,
      status: stringValue(formData, "status", appointment.status),
      serviceName,
      estimatedRevenue,
      estimatedJobHours: Math.round((durationMinutes / 60) * 10) / 10,
      notes: stringValue(formData, "notes") || null
    }
  });
  if (formData.has("serviceName")) {
    await prisma.appointmentService.deleteMany({ where: { appointmentId: id } });
    await prisma.appointmentService.create({
      data: {
        appointmentId: id,
        serviceName,
        estimatedPrice: estimatedRevenue,
        estimatedDurationMinutes: durationMinutes,
        status: stringValue(formData, "status", appointment.status) === "COMPLETED" ? "COMPLETED" : "SCHEDULED"
      }
    });
  }
  revalidatePath("/app/calendar");
  revalidatePath("/app");
  revalidatePath(`/app/appointments/${id}`);
}

export async function deleteAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId } });
  if (!appointment) return;
  await prisma.appointment.deleteMany({
    where: {
      shopId: user.shopId,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      scheduledAt: appointment.scheduledAt
    }
  });
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
  const serviceName = stringValue(formData, "serviceName");
  const estimatedRevenue = numberValue(formData, "estimatedRevenue", 120);
  const durationMinutes = numberValue(formData, "durationMinutes", 60);
  await prisma.appointment.create({
    data: {
      shopId: shop.id,
      customerId: customer.id,
      vehicleId: vehicle.id,
      scheduledAt: dateValue(formData, "scheduledAt"),
      serviceName,
      estimatedRevenue,
      durationMinutes,
      estimatedJobHours: Math.round((durationMinutes / 60) * 10) / 10,
      services: {
        create: {
          serviceName,
          estimatedPrice: estimatedRevenue,
          estimatedDurationMinutes: durationMinutes
        }
      }
    }
  });
  redirect(`/booking/${slug}?booked=1`);
}

type AppointmentServiceInput = {
  serviceTemplateId?: string | null;
  maintenanceItemId?: string | null;
  serviceName: string;
  estimatedPrice: number;
  estimatedDurationMinutes: number;
};

function appointmentSummary(services: AppointmentServiceInput[]) {
  const primary = services[0]?.serviceName || "Vehicle service";
  const remaining = Math.max(0, services.length - 1);
  return remaining ? `${primary} + ${remaining} more` : primary;
}

function appointmentTotals(services: AppointmentServiceInput[]) {
  const totalValue = services.reduce((sum, service) => sum + service.estimatedPrice, 0);
  const totalDurationMinutes = services.reduce((sum, service) => sum + service.estimatedDurationMinutes, 0);
  return {
    totalValue,
    totalDurationMinutes: Math.max(15, totalDurationMinutes),
    estimatedJobHours: Math.round((Math.max(15, totalDurationMinutes) / 60) * 10) / 10
  };
}

function appointmentServiceIdentity(service: AppointmentServiceInput) {
  return service.maintenanceItemId || `${service.serviceName}:${service.estimatedPrice}:${service.estimatedDurationMinutes}`;
}

async function appointmentServicesFromForm(shopId: string, vehicleId: string, formData: FormData): Promise<AppointmentServiceInput[]> {
  const maintenanceIds = stringValues(formData, "maintenanceIds");
  const servicesFromMaintenance = maintenanceIds.length
    ? await prisma.maintenanceItem.findMany({
        where: {
          id: { in: maintenanceIds },
          vehicleId,
          vehicle: { customer: { shopId } }
        },
        include: { service: true }
      })
    : [];
  const maintenanceServices = servicesFromMaintenance.map((item) => ({
    serviceTemplateId: item.serviceId,
    maintenanceItemId: item.id,
    serviceName: item.service?.name ?? item.name,
    estimatedPrice: Math.max(0, item.averagePrice),
    estimatedDurationMinutes: Math.max(15, numberValue(formData, "estimatedDurationMinutes", 45))
  }));

  const serviceNames = stringValues(formData, "serviceNames");
  const estimatedPrices = formData.getAll("estimatedPrices");
  const estimatedDurations = formData.getAll("estimatedDurations");
  const explicitServices = serviceNames.map((name, index) => ({
    serviceTemplateId: null,
    maintenanceItemId: null,
    serviceName: name,
    estimatedPrice: Math.max(0, Number(estimatedPrices[index] ?? 0) || 0),
    estimatedDurationMinutes: Math.max(15, Number(estimatedDurations[index] ?? 60) || 60)
  }));

  const fallbackName = stringValue(formData, "serviceName");
  const fallbackServices = fallbackName && !maintenanceServices.length && !explicitServices.length
    ? [{
        serviceTemplateId: null,
        maintenanceItemId: null,
        serviceName: fallbackName,
        estimatedPrice: Math.max(0, numberValue(formData, "estimatedRevenue", 0)),
        estimatedDurationMinutes: Math.max(15, numberValue(formData, "durationMinutes", 60))
      }]
    : [];

  const unique = [...maintenanceServices, ...explicitServices, ...fallbackServices].reduce((map, service) => {
    if (service.serviceName.trim() && !map.has(appointmentServiceIdentity(service))) {
      map.set(appointmentServiceIdentity(service), service);
    }
    return map;
  }, new Map<string, AppointmentServiceInput>());

  return Array.from(unique.values());
}

async function syncAppointmentAggregate(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { services: true }
  });
  if (!appointment) return null;
  const services = appointment.services.map((service) => ({
    serviceTemplateId: service.serviceTemplateId,
    maintenanceItemId: service.maintenanceItemId,
    serviceName: service.serviceName,
    estimatedPrice: service.estimatedPrice,
    estimatedDurationMinutes: service.estimatedDurationMinutes
  }));
  if (!services.length) {
    return prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        serviceName: "Vehicle visit",
        estimatedRevenue: 0,
        durationMinutes: 60,
        estimatedJobHours: 1
      }
    });
  }
  const totals = appointmentTotals(services);
  return prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      serviceName: appointmentSummary(services),
      estimatedRevenue: totals.totalValue,
      durationMinutes: totals.totalDurationMinutes,
      estimatedJobHours: totals.estimatedJobHours
    }
  });
}

export async function addAppointmentServiceAction(formData: FormData) {
  const user = await requireUser();
  const appointmentId = stringValue(formData, "appointmentId");
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, shopId: user.shopId }
  });
  if (!appointment) return;
  const maintenanceItemId = stringValue(formData, "maintenanceItemId") || null;
  const maintenanceItem = maintenanceItemId
    ? await prisma.maintenanceItem.findFirst({
        where: { id: maintenanceItemId, vehicleId: appointment.vehicleId, vehicle: { customer: { shopId: user.shopId } } },
        include: { service: true }
      })
    : null;
  await prisma.appointmentService.create({
    data: {
      appointmentId,
      serviceTemplateId: maintenanceItem?.serviceId ?? null,
      maintenanceItemId: maintenanceItem?.id ?? null,
      serviceName: maintenanceItem?.service?.name ?? maintenanceItem?.name ?? stringValue(formData, "serviceName", "Vehicle service"),
      estimatedPrice: Math.max(0, optionalNumberValue(formData, "estimatedPrice") ?? maintenanceItem?.averagePrice ?? 0),
      estimatedDurationMinutes: Math.max(15, optionalNumberValue(formData, "estimatedDurationMinutes") ?? 60)
    }
  });
  await syncAppointmentAggregate(appointmentId);
  revalidatePath(`/app/appointments/${appointmentId}`);
  revalidatePath("/app/calendar");
  revalidatePath("/app");
}

export async function removeAppointmentServiceAction(formData: FormData) {
  const user = await requireUser();
  const serviceId = stringValue(formData, "appointmentServiceId");
  const service = await prisma.appointmentService.findFirst({
    where: { id: serviceId, appointment: { shopId: user.shopId } }
  });
  if (!service) return;
  await prisma.appointmentService.delete({ where: { id: service.id } });
  await syncAppointmentAggregate(service.appointmentId);
  revalidatePath(`/app/appointments/${service.appointmentId}`);
  revalidatePath("/app/calendar");
  revalidatePath("/app");
}

export async function cancelAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({ where: { id, shopId: user.shopId } });
  if (!appointment) return;
  await prisma.appointment.updateMany({
    where: {
      shopId: user.shopId,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      scheduledAt: appointment.scheduledAt
    },
    data: { status: "CANCELLED" }
  });
  await prisma.appointmentService.updateMany({
    where: {
      appointment: {
        shopId: user.shopId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        scheduledAt: appointment.scheduledAt
      }
    },
    data: { status: "CANCELLED" }
  });
  revalidatePath(`/app/appointments/${id}`);
  revalidatePath("/app/calendar");
  revalidatePath("/app");
}

export async function completeAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const id = stringValue(formData, "id");
  const appointment = await prisma.appointment.findFirst({
    where: { id, shopId: user.shopId },
    include: { vehicle: true }
  });
  if (!appointment) return;
  const mileage = requiredMileage(formData);
  if (mileage === null) failWithMessage(formData, `/app/appointments/${id}`, "Completion mileage is required and cannot be negative.");
  const mileageError = await validateMileageForVehicle(appointment.vehicleId, mileage, formData.get("confirmLowerMileage") === "on");
  if (mileageError) failWithMessage(formData, `/app/appointments/${id}`, mileageError);
  const visitAppointments = await prisma.appointment.findMany({
    where: {
      shopId: user.shopId,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      scheduledAt: appointment.scheduledAt
    },
    include: { services: true }
  });
  const serviceDate = dateValue(formData, "serviceDate", new Date());
  const serviceLines = visitAppointments.flatMap((visit) =>
    visit.services.length
      ? visit.services.map((service) => ({ appointment: visit, service }))
      : [{
          appointment: visit,
          service: {
            id: `legacy-${visit.id}`,
            appointmentId: visit.id,
            serviceTemplateId: null,
            maintenanceItemId: null,
            serviceName: visit.serviceName,
            estimatedPrice: visit.estimatedRevenue,
            estimatedDurationMinutes: visit.durationMinutes,
            status: "SCHEDULED",
            createdAt: visit.createdAt
          }
        }]
  );
  const totalRevenue = serviceLines.reduce((sum, line) => sum + line.service.estimatedPrice, 0);
  for (const line of serviceLines) {
    await prisma.serviceRecord.create({
      data: {
        shopId: user.shopId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        technicianId: appointment.technicianId,
        serviceDate,
        mileage,
        summary: line.service.serviceName,
        notes: stringValue(formData, "notes") || appointment.notes,
        revenue: line.service.estimatedPrice
      }
    });
    if (line.service.maintenanceItemId) {
      await prisma.maintenanceItem.update({
        where: { id: line.service.maintenanceItemId },
        data: {
          lastCompletedDate: serviceDate,
          lastCompletedMileage: mileage,
          status: "ACTIVE",
          overrideDueDate: null,
          overrideDueMileage: null
        }
      });
    }
  }
  await prisma.customer.update({
    where: { id: appointment.customerId },
    data: { lifetimeSpend: { increment: totalRevenue } }
  });
  await prisma.appointment.updateMany({
    where: {
      shopId: user.shopId,
      customerId: appointment.customerId,
      vehicleId: appointment.vehicleId,
      scheduledAt: appointment.scheduledAt
    },
    data: {
      status: "COMPLETED",
      actualJobHours: Math.round((serviceLines.reduce((sum, line) => sum + line.service.estimatedDurationMinutes, 0) / 60) * 10) / 10
    }
  });
  await prisma.appointmentService.updateMany({
    where: {
      appointment: {
        shopId: user.shopId,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
        scheduledAt: appointment.scheduledAt
      }
    },
    data: { status: "COMPLETED" }
  });
  await recordMileage({
    vehicleId: appointment.vehicleId,
    mileage,
    loggedAt: serviceDate,
    source: "appointment completion",
    previousCurrentMileage: appointment.vehicle.currentMileage,
    allowLowerCurrent: formData.get("confirmLowerMileage") === "on"
  });
  revalidatePath(`/app/appointments/${id}`);
  revalidatePath(vehicleDashboardPath(appointment.customerId, appointment.vehicleId));
  revalidatePath(`/app/customers/${appointment.customerId}`);
  revalidatePath("/app/calendar");
  revalidatePath("/app/maintenance");
  revalidatePath("/app/forecast");
  revalidatePath("/app");
}

async function createAppointmentForShop(shopId: string, formData: FormData) {
  const customerId = stringValue(formData, "customerId");
  const vehicleId = stringValue(formData, "vehicleId");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId } });
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, customer: { shopId } } });
  if (!customer || !vehicle) return null;
  const services = await appointmentServicesFromForm(shopId, vehicleId, formData);
  if (!services.length) return null;
  const scheduledAt = dateValue(formData, "scheduledAt");
  const existing = await prisma.appointment.findFirst({
    where: { shopId, customerId, vehicleId, scheduledAt },
    include: { services: true }
  });
  if (existing) {
    const existingIds = new Set(existing.services.map((service) => service.maintenanceItemId || `${service.serviceName}:${service.estimatedPrice}:${service.estimatedDurationMinutes}`));
    const missingServices = services.filter((service) => !existingIds.has(appointmentServiceIdentity(service)));
    for (const service of missingServices) {
      await prisma.appointmentService.create({
        data: {
          appointmentId: existing.id,
          serviceTemplateId: service.serviceTemplateId,
          maintenanceItemId: service.maintenanceItemId,
          serviceName: service.serviceName,
          estimatedPrice: service.estimatedPrice,
          estimatedDurationMinutes: service.estimatedDurationMinutes
        }
      });
    }
    await prisma.appointment.update({
      where: { id: existing.id },
      data: {
        technicianId: stringValue(formData, "technicianId") || existing.technicianId,
        notes: stringValue(formData, "notes") || existing.notes
      }
    });
    return syncAppointmentAggregate(existing.id);
  }
  const totals = appointmentTotals(services);
  return prisma.appointment.create({
    data: {
      shopId,
      customerId,
      vehicleId,
      technicianId: stringValue(formData, "technicianId") || null,
      scheduledAt,
      durationMinutes: totals.totalDurationMinutes,
      serviceName: appointmentSummary(services),
      estimatedRevenue: totals.totalValue,
      estimatedJobHours: totals.estimatedJobHours,
      notes: stringValue(formData, "notes") || null,
      services: {
        create: services.map((service) => ({
          serviceTemplateId: service.serviceTemplateId,
          maintenanceItemId: service.maintenanceItemId,
          serviceName: service.serviceName,
          estimatedPrice: service.estimatedPrice,
          estimatedDurationMinutes: service.estimatedDurationMinutes
        }))
      }
    }
  });
}

type QuoteLineInput = {
  lineType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  sourceType?: string;
  sourceId?: string;
};

function quoteExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date;
}

function normalizeQuoteLine(line: QuoteLineInput) {
  const quantity = Math.max(0, Number.isFinite(line.quantity) ? line.quantity : 1);
  const unitPrice = Math.max(0, Number.isFinite(line.unitPrice) ? line.unitPrice : 0);
  const rawTotal = quantity * unitPrice;
  const total = line.lineType === "DISCOUNT" ? -Math.abs(rawTotal) : rawTotal;
  return {
    lineType: line.lineType,
    description: line.description,
    quantity,
    unitPrice,
    total,
    sourceType: line.sourceType ?? null,
    sourceId: line.sourceId ?? null
  };
}

function quoteTotals(lines: Array<ReturnType<typeof normalizeQuoteLine>>) {
  const subtotal = lines
    .filter((line) => line.lineType !== "TAX" && line.lineType !== "DISCOUNT")
    .reduce((sum, line) => sum + line.total, 0);
  const discountTotal = Math.abs(lines.filter((line) => line.lineType === "DISCOUNT").reduce((sum, line) => sum + line.total, 0));
  const taxTotal = lines.filter((line) => line.lineType === "TAX").reduce((sum, line) => sum + line.total, 0);
  return {
    subtotal,
    discountTotal,
    taxTotal,
    total: Math.max(0, subtotal - discountTotal + taxTotal)
  };
}

async function nextQuoteNumber(shopId: string) {
  const count = await prisma.quote.count({ where: { shopId } });
  return `Q-${String(count + 1).padStart(5, "0")}`;
}

async function createQuoteForShop(params: {
  shopId: string;
  customerId: string;
  vehicleId: string;
  serviceRecordId?: string | null;
  status?: string;
  notes?: string | null;
  expirationDate?: Date;
  lines: QuoteLineInput[];
}) {
  const lines = params.lines
    .filter((line) => line.description.trim())
    .map((line) => normalizeQuoteLine(line));
  if (!lines.length) return null;
  const totals = quoteTotals(lines);
  return prisma.quote.create({
    data: {
      shopId: params.shopId,
      customerId: params.customerId,
      vehicleId: params.vehicleId,
      serviceRecordId: params.serviceRecordId ?? null,
      quoteNumber: await nextQuoteNumber(params.shopId),
      status: params.status ?? "DRAFT",
      expirationDate: params.expirationDate ?? quoteExpirationDate(),
      notes: params.notes ?? null,
      shareToken: crypto.randomBytes(24).toString("hex"),
      ...totals,
      lines: { create: lines }
    },
    include: { lines: true }
  });
}

async function maintenanceQuoteLines(shopId: string, maintenanceIds: string[]) {
  if (!maintenanceIds.length) return { lines: [] as QuoteLineInput[], first: null as null | { customerId: string; vehicleId: string } };
  const items = await prisma.maintenanceItem.findMany({
    where: {
      id: { in: maintenanceIds },
      serviceId: { not: null },
      vehicle: { customer: { shopId } }
    },
    include: { vehicle: true }
  });
  return {
    first: items[0] ? { customerId: items[0].vehicle.customerId, vehicleId: items[0].vehicleId } : null,
    lines: items.map((item) => ({
      lineType: "SERVICE",
      description: item.name,
      quantity: 1,
      unitPrice: item.averagePrice,
      sourceType: "MAINTENANCE",
      sourceId: item.id
    }))
  };
}

export async function createQuoteAction(formData: FormData) {
  const user = await requireUser();
  const vehicleId = stringValue(formData, "vehicleId");
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, customer: { shopId: user.shopId } }
  });
  if (!vehicle) failWithMessage(formData, "/app/quotes", "Select a valid customer and vehicle before creating a quote.");
  const customerId = vehicle.customerId;

  const maintenanceIds = stringValues(formData, "maintenanceIds");
  const { lines } = await maintenanceQuoteLines(user.shopId, maintenanceIds);
  const serviceIds = stringValues(formData, "serviceIds");
  if (serviceIds.length) {
    const services = await prisma.service.findMany({ where: { id: { in: serviceIds }, shopId: user.shopId } });
    lines.push(...services.map((service) => ({
      lineType: "SERVICE",
      description: service.name,
      quantity: 1,
      unitPrice: service.averagePrice,
      sourceType: "SERVICE",
      sourceId: service.id
    })));
  }

  const laborDescription = stringValue(formData, "laborDescription");
  if (laborDescription) {
    lines.push({
      lineType: "LABOR",
      description: laborDescription,
      quantity: Math.max(0, numberValue(formData, "laborHours", 1)),
      unitPrice: Math.max(0, numberValue(formData, "laborRate", 125))
    });
  }
  const partDescription = stringValue(formData, "partDescription");
  if (partDescription) {
    lines.push({
      lineType: "PART",
      description: partDescription,
      quantity: Math.max(0, numberValue(formData, "partQuantity", 1)),
      unitPrice: Math.max(0, numberValue(formData, "partPrice", 0))
    });
  }
  const lineTypes = formData.getAll("lineType").map((value) => String(value || "SERVICE"));
  const descriptions = formData.getAll("lineDescription").map((value) => String(value ?? "").trim());
  const quantities = formData.getAll("lineQuantity");
  const unitPrices = formData.getAll("lineUnitPrice");
  descriptions.forEach((description, index) => {
    const type = lineTypes[index] || "SERVICE";
    const quantity = Number(quantities[index] ?? 1);
    const unitPrice = Number(unitPrices[index] ?? 0);
    if (description.trim()) {
      lines.push({
        lineType: type,
        description,
        quantity: Number.isFinite(quantity) ? quantity : 1,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0
      });
    }
  });
  const shopFee = Math.max(0, numberValue(formData, "shopFee", 0));
  if (shopFee) lines.push({ lineType: "FEE", description: "Shop supplies and fees", quantity: 1, unitPrice: shopFee });
  const discountAmount = Math.max(0, numberValue(formData, "discountAmount", 0));
  if (discountAmount) lines.push({ lineType: "DISCOUNT", description: "Discount", quantity: 1, unitPrice: discountAmount });
  const taxableBase = quoteTotals(lines.map((line) => normalizeQuoteLine(line))).subtotal - discountAmount;
  const taxRate = Math.max(0, numberValue(formData, "taxRate", 0));
  if (taxRate) lines.push({ lineType: "TAX", description: `Tax (${taxRate}%)`, quantity: 1, unitPrice: Math.max(0, taxableBase * (taxRate / 100)) });

  const quote = await createQuoteForShop({
    shopId: user.shopId,
    customerId,
    vehicleId,
    notes: stringValue(formData, "notes") || null,
    expirationDate: optionalDateValue(formData, "expirationDate") ?? quoteExpirationDate(),
    lines
  });
  if (!quote) failWithMessage(formData, "/app/quotes", "Add at least one service, labor, part, fee, or discount line.");
  revalidatePath("/app/quotes");
  revalidatePath("/app");
  redirect(`/app/quotes/${quote.id}`);
}

export async function generateQuoteFromMaintenanceAction(formData: FormData) {
  const user = await requireUser();
  const maintenanceIds = stringValues(formData, "maintenanceIds");
  const { first, lines } = await maintenanceQuoteLines(user.shopId, maintenanceIds);
  if (!first || !lines.length) failWithMessage(formData, "/app/maintenance", "No maintenance services were selected for the quote.");
  const quote = await createQuoteForShop({
    shopId: user.shopId,
    customerId: first.customerId,
    vehicleId: first.vehicleId,
    notes: "Generated from overdue and due-soon maintenance opportunities.",
    lines
  });
  if (!quote) failWithMessage(formData, "/app/maintenance", "Quote could not be created.");
  revalidatePath("/app/quotes");
  revalidatePath("/app");
  redirect(`/app/quotes/${quote.id}`);
}

export async function generateQuoteFromServiceRecordAction(formData: FormData) {
  const user = await requireUser();
  const record = await prisma.serviceRecord.findFirst({
    where: { id: stringValue(formData, "serviceRecordId"), shopId: user.shopId },
    include: { vehicle: true }
  });
  if (!record) return;
  const description = record.nextRecommendedService || `Follow-up: ${record.summary}`;
  const price = Math.max(0, numberValue(formData, "estimatedRevenue", record.revenue || 0));
  const quote = await createQuoteForShop({
    shopId: user.shopId,
    customerId: record.customerId ?? record.vehicle.customerId,
    vehicleId: record.vehicleId,
    serviceRecordId: record.id,
    notes: "Generated from service record follow-up.",
    lines: [{ lineType: "SERVICE", description, quantity: 1, unitPrice: price, sourceType: "SERVICE_RECORD", sourceId: record.id }]
  });
  if (!quote) return;
  revalidatePath("/app/quotes");
  redirect(`/app/quotes/${quote.id}`);
}

export async function duplicateQuoteAction(formData: FormData) {
  const user = await requireUser();
  const quote = await prisma.quote.findFirst({
    where: { id: stringValue(formData, "quoteId"), shopId: user.shopId },
    include: { lines: true }
  });
  if (!quote) return;
  const duplicate = await createQuoteForShop({
    shopId: user.shopId,
    customerId: quote.customerId,
    vehicleId: quote.vehicleId,
    serviceRecordId: quote.serviceRecordId,
    notes: quote.notes,
    lines: quote.lines.map((line) => ({
      lineType: line.lineType,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      sourceType: line.sourceType ?? undefined,
      sourceId: line.sourceId ?? undefined
    }))
  });
  revalidatePath("/app/quotes");
  if (duplicate) redirect(`/app/quotes/${duplicate.id}`);
}

export async function updateQuoteStatusAction(formData: FormData) {
  const user = await requireUser();
  const quote = await prisma.quote.findFirst({ where: { id: stringValue(formData, "quoteId"), shopId: user.shopId } });
  if (!quote) return;
  const status = stringValue(formData, "status", quote.status);
  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status,
      approvedAt: status === "APPROVED" ? new Date() : quote.approvedAt,
      declinedAt: status === "DECLINED" ? new Date() : quote.declinedAt
    }
  });
  revalidatePath("/app/quotes");
  revalidatePath(`/app/quotes/${quote.id}`);
  revalidatePath("/app");
}

export async function sendQuoteAction(formData: FormData) {
  formData.set("status", "SENT");
  await updateQuoteStatusAction(formData);
}

export async function convertQuoteToAppointmentAction(formData: FormData) {
  const user = await requireUser();
  const quote = await prisma.quote.findFirst({
    where: { id: stringValue(formData, "quoteId"), shopId: user.shopId },
    include: { lines: true }
  });
  if (!quote) return;
  const durationMinutes = numberValue(formData, "durationMinutes", 120);
  const appointmentServices = quote.lines
    .filter((line) => line.lineType !== "TAX" && line.lineType !== "DISCOUNT")
    .map((line) => ({
      serviceName: line.description,
      estimatedPrice: Math.max(0, line.total),
      estimatedDurationMinutes: Math.max(15, Math.round(durationMinutes / Math.max(1, quote.lines.length)))
    }));
  const services = appointmentServices.length ? appointmentServices : [{
    serviceName: quote.quoteNumber,
    estimatedPrice: quote.total,
    estimatedDurationMinutes: durationMinutes
  }];
  const totals = appointmentTotals(services);
  await prisma.appointment.create({
    data: {
      shopId: user.shopId,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      scheduledAt: dateValue(formData, "scheduledAt", new Date(Date.now() + 86400000)),
      durationMinutes: totals.totalDurationMinutes,
      serviceName: appointmentSummary(services),
      estimatedRevenue: totals.totalValue,
      estimatedJobHours: totals.estimatedJobHours,
      notes: `Converted from quote ${quote.quoteNumber}.`,
      services: {
        create: services
      }
    }
  });
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: quote.status === "APPROVED" ? "APPROVED" : "SENT" }
  });
  revalidatePath("/app/calendar");
  revalidatePath("/app/quotes");
  revalidatePath("/app");
  redirect("/app/calendar");
}

export async function approvePublicQuoteAction(formData: FormData) {
  const quote = await prisma.quote.findUnique({ where: { shareToken: stringValue(formData, "token") } });
  if (!quote) return;
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "APPROVED", approvedAt: new Date(), declinedAt: null }
  });
  revalidatePath(`/quote/${quote.shareToken}`);
  revalidatePath("/app/quotes");
  redirect(`/quote/${quote.shareToken}?approved=1`);
}

export async function declinePublicQuoteAction(formData: FormData) {
  const quote = await prisma.quote.findUnique({ where: { shareToken: stringValue(formData, "token") } });
  if (!quote) return;
  await prisma.quote.update({
    where: { id: quote.id },
    data: { status: "DECLINED", declinedAt: new Date(), approvedAt: null }
  });
  revalidatePath(`/quote/${quote.shareToken}`);
  revalidatePath("/app/quotes");
  redirect(`/quote/${quote.shareToken}?declined=1`);
}

export async function requestQuoteCallbackAction(formData: FormData) {
  const quote = await prisma.quote.findUnique({ where: { shareToken: stringValue(formData, "token") } });
  if (!quote) return;
  await prisma.quote.update({
    where: { id: quote.id },
    data: { callbackRequestedAt: new Date() }
  });
  revalidatePath(`/quote/${quote.shareToken}`);
  revalidatePath("/app/quotes");
  redirect(`/quote/${quote.shareToken}?callback=1`);
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
  if (!service) failWithMessage(formData, "/app/settings/service-library", "Service could not be found.");
  try {
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
  } catch {
    failWithMessage(formData, "/app/settings/service-library", "Service update failed.");
  }
  revalidatePath("/app/settings/service-library");
  revalidatePath("/app/maintenance");
  revalidatePath("/app");
  redirect("/app/settings/service-library?success=Service%20Updated%20Successfully");
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

export async function duplicateServicePackageAction(formData: FormData) {
  const user = await requireUser();
  const servicePackage = await prisma.servicePackage.findFirst({
    where: { id: stringValue(formData, "packageId"), shopId: user.shopId },
    include: { items: true }
  });
  if (!servicePackage) return;
  await prisma.servicePackage.create({
    data: {
      shopId: user.shopId,
      name: `${servicePackage.name} Copy`,
      description: servicePackage.description,
      status: servicePackage.status,
      items: {
        create: servicePackage.items.map((item) => ({ serviceId: item.serviceId }))
      }
    }
  });
  revalidatePath("/app/settings/service-library");
}

const industryTemplates: Record<string, Array<{
  name: string;
  category: string;
  defaultMileageInterval: number;
  defaultTimeIntervalMonths: number;
  averagePrice: number;
  defaultReminderThreshold: number;
  description: string;
}>> = {
  "Quick Lube Shop": [
    { name: "Oil change", category: "Fluids", defaultMileageInterval: 5000, defaultTimeIntervalMonths: 6, averagePrice: 90, defaultReminderThreshold: 20, description: "Standard engine oil and filter service." },
    { name: "Tire rotation", category: "Inspection", defaultMileageInterval: 6000, defaultTimeIntervalMonths: 6, averagePrice: 65, defaultReminderThreshold: 15, description: "Rotate tires and inspect tread wear." },
    { name: "Air filter", category: "Filters", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20, description: "Replace engine air filter." },
    { name: "Cabin filter", category: "Filters", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20, description: "Replace cabin air filter." }
  ],
  "Independent Repair Shop": [
    { name: "Brake inspection", category: "Brakes", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 120, defaultReminderThreshold: 10, description: "Inspect pads, rotors, calipers, and brake fluid condition." },
    { name: "Brake pads", category: "Brakes", defaultMileageInterval: 40000, defaultTimeIntervalMonths: 36, averagePrice: 650, defaultReminderThreshold: 10, description: "Replace brake pads and inspect braking hardware." },
    { name: "Coolant flush", category: "Cooling System", defaultMileageInterval: 30000, defaultTimeIntervalMonths: 36, averagePrice: 180, defaultReminderThreshold: 15, description: "Cooling system flush and refill." },
    { name: "Spark plugs", category: "Engine", defaultMileageInterval: 90000, defaultTimeIntervalMonths: 72, averagePrice: 420, defaultReminderThreshold: 10, description: "Replace spark plugs and inspect ignition components." }
  ],
  "Fleet Maintenance": [
    { name: "Fleet inspection", category: "Inspection", defaultMileageInterval: 10000, defaultTimeIntervalMonths: 3, averagePrice: 180, defaultReminderThreshold: 15, description: "Recurring fleet safety and maintenance inspection." },
    { name: "DOT inspection", category: "Inspection", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 220, defaultReminderThreshold: 15, description: "Annual DOT-style vehicle inspection." },
    { name: "Transmission service", category: "Fluids", defaultMileageInterval: 60000, defaultTimeIntervalMonths: 48, averagePrice: 320, defaultReminderThreshold: 15, description: "Transmission fluid and service inspection." }
  ],
  "Diesel Shop": [
    { name: "Diesel oil service", category: "Fluids", defaultMileageInterval: 7500, defaultTimeIntervalMonths: 6, averagePrice: 180, defaultReminderThreshold: 20, description: "Diesel engine oil and filter service." },
    { name: "Fuel filter", category: "Filters", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 160, defaultReminderThreshold: 20, description: "Replace diesel fuel filter." },
    { name: "DEF system inspection", category: "Electrical", defaultMileageInterval: 20000, defaultTimeIntervalMonths: 12, averagePrice: 140, defaultReminderThreshold: 15, description: "Inspect DEF system and emissions components." }
  ],
  Dealership: [
    { name: "Factory scheduled maintenance", category: "Inspection", defaultMileageInterval: 30000, defaultTimeIntervalMonths: 24, averagePrice: 520, defaultReminderThreshold: 15, description: "OEM interval package inspection and services." },
    { name: "Warranty inspection", category: "Inspection", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 95, defaultReminderThreshold: 10, description: "Warranty-related inspection and documentation." },
    { name: "Software update inspection", category: "Electrical", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 85, defaultReminderThreshold: 15, description: "Check vehicle module update availability." }
  ]
};

export async function importServiceTemplateAction(formData: FormData) {
  const user = await requireUser();
  const template = stringValue(formData, "template");
  const services = industryTemplates[template] ?? [];
  if (!services.length) return;
  const existing = await prisma.service.findMany({
    where: { shopId: user.shopId, name: { in: services.map((service) => service.name) } },
    select: { name: true }
  });
  const existingNames = new Set(existing.map((service) => service.name));
  const toCreate = services.filter((service) => !existingNames.has(service.name));
  if (toCreate.length) {
    await prisma.service.createMany({
      data: toCreate.map((service) => ({ shopId: user.shopId, ...service }))
    });
  }
  revalidatePath("/app/settings/service-library");
  redirect(`/app/settings/service-library?success=${encodeURIComponent(`${template} templates imported`)}`);
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
