"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, currentUser, hashPassword, requireUser, signOut, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";

function stringValue(formData: FormData, key: string, fallback = "") {
  return String(formData.get(key) ?? fallback).trim();
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const value = Number(formData.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function dateValue(formData: FormData, key: string, fallback = new Date()) {
  const raw = stringValue(formData, key);
  return raw ? new Date(raw) : fallback;
}

export async function loginAction(formData: FormData) {
  const email = stringValue(formData, "email").toLowerCase();
  const password = stringValue(formData, "password");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    redirect("/login?error=Invalid%20email%20or%20password");
  }
  await createSession(user.id);
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
  const currentMileage = numberValue(formData, "currentMileage", 0);
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
          vehicleType: stringValue(formData, "vehicleType") || null,
          currentMileage,
          estimatedMilesYear: numberValue(formData, "estimatedMilesYear", 12000),
          mileageLogs: { create: { mileage: currentMileage, loggedAt: new Date(), source: "onboarding" } }
        }
      }
    },
    include: { vehicles: true }
  });
  const vehicle = customer.vehicles[0];
  const services = await prisma.service.findMany({ where: { shopId: user.shopId } });
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

export async function createVehicleAction(formData: FormData) {
  const user = await requireUser();
  const customerId = stringValue(formData, "customerId");
  const customer = await prisma.customer.findFirst({ where: { id: customerId, shopId: user.shopId } });
  if (!customer) return;
  const currentMileage = numberValue(formData, "currentMileage", 0);
  const vehicle = await prisma.vehicle.create({
    data: {
      customerId,
      year: numberValue(formData, "year", new Date().getFullYear()),
      make: stringValue(formData, "make"),
      model: stringValue(formData, "model"),
      vehicleType: stringValue(formData, "vehicleType") || null,
      vin: stringValue(formData, "vin") || null,
      licensePlate: stringValue(formData, "licensePlate") || null,
      currentMileage,
      estimatedMilesYear: numberValue(formData, "estimatedMilesYear", 12000),
      mileageLogs: { create: { mileage: currentMileage, loggedAt: new Date(), source: "onboarding" } }
    }
  });
  const services = await prisma.service.findMany({ where: { shopId: user.shopId } });
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
  const mileage = numberValue(formData, "mileage", vehicle.currentMileage);
  await prisma.mileageLog.create({
    data: { vehicleId, mileage, loggedAt: dateValue(formData, "loggedAt"), source: stringValue(formData, "source", "service") }
  });
  const logs = [...vehicle.mileageLogs, { mileage, loggedAt: dateValue(formData, "loggedAt") }];
  if (logs.length >= 2) {
    const sorted = logs.sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const days = Math.max(1, (last.loggedAt.getTime() - first.loggedAt.getTime()) / 86400000);
    const annual = Math.round(((last.mileage - first.mileage) / days) * 365);
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { currentMileage: Math.max(vehicle.currentMileage, mileage), estimatedMilesYear: annual > 0 ? annual : vehicle.estimatedMilesYear }
    });
  } else {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileage: Math.max(vehicle.currentMileage, mileage) } });
  }
  revalidatePath("/app/maintenance");
  revalidatePath("/app/customers");
}

export async function completeServiceAction(formData: FormData) {
  const user = await requireUser();
  const maintenanceId = stringValue(formData, "maintenanceId");
  const item = await prisma.maintenanceItem.findFirst({
    where: { id: maintenanceId, vehicle: { customer: { shopId: user.shopId } } },
    include: { vehicle: true }
  });
  if (!item) return;
  const mileage = numberValue(formData, "mileage", item.vehicle.currentMileage);
  const serviceDate = dateValue(formData, "serviceDate");
  const record = await prisma.serviceRecord.create({
    data: {
      shopId: user.shopId,
      vehicleId: item.vehicleId,
      serviceDate,
      mileage,
      summary: `${item.name} completed`,
      revenue: numberValue(formData, "revenue", item.averagePrice)
    }
  });
  await prisma.maintenanceItem.update({
    where: { id: item.id },
    data: { lastCompletedDate: serviceDate, lastCompletedMileage: mileage }
  });
  await prisma.mileageLog.create({ data: { vehicleId: item.vehicleId, mileage, loggedAt: serviceDate, source: "completed service" } });
  await prisma.vehicle.update({ where: { id: item.vehicleId }, data: { currentMileage: Math.max(item.vehicle.currentMileage, mileage) } });

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
  revalidatePath("/app/forecast");
}

export async function createAppointmentAction(formData: FormData) {
  const user = await requireUser();
  await createAppointmentForShop(user.shopId, formData);
  revalidatePath("/app/calendar");
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

export async function createPublicBookingAction(slug: string, formData: FormData) {
  const shop = await prisma.shop.findUnique({ where: { slug } });
  if (!shop) return;
  const customerEmail = stringValue(formData, "email") || null;
  const customer = await prisma.customer.upsert({
    where: { id: stringValue(formData, "customerId", "new") },
    update: {},
    create: {
      shopId: shop.id,
      name: stringValue(formData, "name"),
      phone: stringValue(formData, "phone"),
      email: customerEmail,
      communicationPrefs: "SMS"
    }
  }).catch(async () => prisma.customer.create({
    data: {
      shopId: shop.id,
      name: stringValue(formData, "name"),
      phone: stringValue(formData, "phone"),
      email: customerEmail,
      communicationPrefs: "SMS"
    }
  }));
  const vehicle = await prisma.vehicle.create({
    data: {
      customerId: customer.id,
      year: numberValue(formData, "year", new Date().getFullYear()),
      make: stringValue(formData, "make"),
      model: stringValue(formData, "model"),
      vehicleType: stringValue(formData, "vehicleType") || null,
      currentMileage: numberValue(formData, "currentMileage", 0),
      mileageLogs: { create: { mileage: numberValue(formData, "currentMileage", 0), source: "booking" } }
    }
  });
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
      enabled: formData.get("enabled") === "on"
    },
    create: {
      shopId: user.shopId,
      serviceName: stringValue(formData, "serviceName"),
      thresholdPercentage: numberValue(formData, "thresholdPercentage", 20),
      enabled: formData.get("enabled") === "on"
    }
  }).catch(async () => {
    await prisma.reminderRule.create({
      data: {
        shopId: user.shopId,
        serviceName: stringValue(formData, "serviceName"),
        thresholdPercentage: numberValue(formData, "thresholdPercentage", 20),
        enabled: formData.get("enabled") === "on"
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
  const message = `Hi ${item.vehicle.customer.name}, based on your driving habits, your ${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model} is approaching its next ${item.name}. Book your appointment here: ${user.shop.bookingLink || `/booking/${user.shop.slug}`}`;
  await prisma.reminderLog.create({
    data: {
      maintenanceItemId: item.id,
      customerName: item.vehicle.customer.name,
      phone: item.vehicle.customer.phone,
      message: `${message} Estimated due: ${prediction.dueDate.toLocaleDateString()}.`,
      status: process.env.SMS_API_KEY ? "SENT" : "MOCK_SENT"
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
      role: stringValue(formData, "role", "Technician")
    }
  });
  revalidatePath("/app/team");
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
    { name: "Oil change", defaultMileageInterval: 5000, defaultTimeIntervalMonths: 6, averagePrice: 90, defaultReminderThreshold: 20 },
    { name: "Tire rotation", defaultMileageInterval: 6000, defaultTimeIntervalMonths: 6, averagePrice: 65, defaultReminderThreshold: 15 },
    { name: "Brake inspection", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 120, defaultReminderThreshold: 10 },
    { name: "Transmission service", defaultMileageInterval: 60000, defaultTimeIntervalMonths: 48, averagePrice: 320, defaultReminderThreshold: 15 },
    { name: "Coolant flush", defaultMileageInterval: 30000, defaultTimeIntervalMonths: 36, averagePrice: 180, defaultReminderThreshold: 15 },
    { name: "Spark plugs", defaultMileageInterval: 90000, defaultTimeIntervalMonths: 72, averagePrice: 420, defaultReminderThreshold: 10 },
    { name: "Air filter", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20 },
    { name: "Cabin filter", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20 },
    { name: "Battery inspection", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 40, defaultReminderThreshold: 10 }
  ];
}
