import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return `${salt}:${derived.toString("hex")}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function daysFromNow(days: number, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

const services = [
  { name: "Oil change", defaultMileageInterval: 5000, defaultTimeIntervalMonths: 6, averagePrice: 90, defaultReminderThreshold: 20 },
  { name: "Tire rotation", defaultMileageInterval: 6000, defaultTimeIntervalMonths: 6, averagePrice: 65, defaultReminderThreshold: 15 },
  { name: "Brake inspection", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 120, defaultReminderThreshold: 10 },
  { name: "Brake pads", defaultMileageInterval: 40000, defaultTimeIntervalMonths: 36, averagePrice: 650, defaultReminderThreshold: 10 },
  { name: "Brake rotors", defaultMileageInterval: 70000, defaultTimeIntervalMonths: 48, averagePrice: 820, defaultReminderThreshold: 10 },
  { name: "Transmission service", defaultMileageInterval: 60000, defaultTimeIntervalMonths: 48, averagePrice: 320, defaultReminderThreshold: 15 },
  { name: "Coolant flush", defaultMileageInterval: 30000, defaultTimeIntervalMonths: 36, averagePrice: 180, defaultReminderThreshold: 15 },
  { name: "Spark plugs", defaultMileageInterval: 90000, defaultTimeIntervalMonths: 72, averagePrice: 420, defaultReminderThreshold: 10 },
  { name: "Air filter", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20 },
  { name: "Cabin filter", defaultMileageInterval: 15000, defaultTimeIntervalMonths: 12, averagePrice: 55, defaultReminderThreshold: 20 },
  { name: "Battery inspection", defaultMileageInterval: 12000, defaultTimeIntervalMonths: 12, averagePrice: 40, defaultReminderThreshold: 10 }
];

async function main() {
  await prisma.session.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.inventoryScanLog.deleteMany();
  await prisma.deferredOpportunity.deleteMany();
  await prisma.serviceRecord.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.maintenanceItem.deleteMany();
  await prisma.mileageLog.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.inventoryItem.deleteMany();
  await prisma.reminderRule.deleteMany();
  await prisma.service.deleteMany();
  await prisma.technician.deleteMany();
  await prisma.user.deleteMany();
  await prisma.shop.deleteMany();

  const shop = await prisma.shop.create({
    data: {
      name: "Demo Auto Care",
      slug: "demo-auto-care",
      plan: "Growth",
      subscriptionStatus: "trialing",
      bookingLink: "/booking/demo-auto-care",
      users: {
        create: [
          {
            name: "Avery Owner",
            email: "owner@maintiva.local",
            passwordHash: await hashPassword("password123"),
            role: "OWNER"
          },
          {
            name: "Mia Mechanic",
            email: "mechanic@maintiva.local",
            passwordHash: await hashPassword("password123"),
            role: "MECHANIC"
          }
        ]
      },
      services: { create: services },
      reminderRules: {
        create: [
          { serviceName: "Oil change", thresholdPercentage: 20, enabled: true },
          { serviceName: "Tire rotation", thresholdPercentage: 15, enabled: true },
          { serviceName: "Brake inspection", thresholdPercentage: 10, enabled: true },
          { serviceName: "Overdue service", thresholdPercentage: 0, enabled: true }
        ]
      },
      technicians: {
        create: [
          { name: "Mia Chen", role: "A Tech", standardHours: 22, actualHours: 24, jobsCompleted: 18 },
          { name: "Luis Ortega", role: "General Service", standardHours: 18, actualHours: 16, jobsCompleted: 15 }
        ]
      },
      inventoryItems: {
        create: [
          { sku: "OIL-5W30-QT", barcode: "850001111001", name: "5W-30 oil", category: "Oil", quantityOnHand: 22, unitType: "quart", reorderThreshold: 30, cost: 4.25, supplier: "NAPA" },
          { sku: "FIL-CAB-204", barcode: "850001111002", name: "Cabin filter CF204", category: "Filters", quantityOnHand: 9, unitType: "each", reorderThreshold: 6, cost: 12.5, supplier: "PartsPlus" },
          { sku: "BRK-CLEAN", barcode: "850001111003", name: "Brake cleaner", category: "Fluids", quantityOnHand: 14, unitType: "can", reorderThreshold: 18, cost: 3.1, supplier: "NAPA" },
          { sku: "COOL-GAL", barcode: "850001111004", name: "Antifreeze coolant", category: "Coolant", quantityOnHand: 7, unitType: "gallon", reorderThreshold: 10, cost: 11.4, supplier: "WorldPac" }
        ]
      }
    }
  });

  const createdServices = await prisma.service.findMany({ where: { shopId: shop.id } });
  const techs = await prisma.technician.findMany({ where: { shopId: shop.id } });

  const john = await prisma.customer.create({
    data: {
      shopId: shop.id,
      name: "John Patel",
      phone: "555-0108",
      email: "john@example.com",
      notes: "Prefers morning appointments. Ask about brake vibration.",
      communicationPrefs: "SMS"
    }
  });
  const maria = await prisma.customer.create({
    data: {
      shopId: shop.id,
      name: "Maria Gonzalez",
      phone: "555-0144",
      email: "maria@example.com",
      notes: "Fleet manager for two vans.",
      communicationPrefs: "SMS + email"
    }
  });
  const eli = await prisma.customer.create({
    data: {
      shopId: shop.id,
      name: "Eli Brooks",
      phone: "555-0182",
      email: "eli@example.com",
      notes: "Often defers non-urgent work.",
      communicationPrefs: "SMS"
    }
  });

  const vehicles = [
    { customerId: john.id, year: 2019, make: "Toyota", model: "Camry", vehicleType: "Sedan", vin: "4T1B11HK8KU000001", licensePlate: "JHN-219", currentMileage: 61000, estimatedMilesYear: 10000, logs: [[166, 56000], [14, 61000]] },
    { customerId: maria.id, year: 2021, make: "Ford", model: "Transit", vehicleType: "Van", vin: "1FTBW2CM1MKA00001", licensePlate: "MGA-421", currentMileage: 82500, estimatedMilesYear: 21500, logs: [[210, 70000], [40, 80000], [5, 82500]] },
    { customerId: eli.id, year: 2017, make: "Honda", model: "CR-V", vehicleType: "SUV", vin: "2HKRW2H82HH000001", licensePlate: "ELI-337", currentMileage: 94200, estimatedMilesYear: 12000, logs: [[350, 82600], [90, 91500], [8, 94200]] }
  ];

  for (const vehicleData of vehicles) {
    const vehicle = await prisma.vehicle.create({
      data: {
        customerId: vehicleData.customerId,
        year: vehicleData.year,
        make: vehicleData.make,
        model: vehicleData.model,
        vehicleType: vehicleData.vehicleType,
        vin: vehicleData.vin,
        licensePlate: vehicleData.licensePlate,
        currentMileage: vehicleData.currentMileage,
        estimatedMilesYear: vehicleData.estimatedMilesYear,
        mileageLogs: {
          create: vehicleData.logs.map(([days, mileage]) => ({
            loggedAt: daysAgo(days),
            mileage,
            source: "seed history"
          }))
        }
      }
    });

    await prisma.maintenanceItem.createMany({
      data: createdServices.map((service, index) => ({
        vehicleId: vehicle.id,
        serviceId: service.id,
        name: service.name,
        lastCompletedDate: daysAgo(40 + index * 17),
        lastCompletedMileage: vehicle.currentMileage - service.defaultMileageInterval + (index % 3) * 1200 + 600,
        mileageInterval: service.defaultMileageInterval,
        timeIntervalMonths: service.defaultTimeIntervalMonths,
        averagePrice: service.averagePrice,
        reminderThresholdPercentage: service.defaultReminderThreshold
      }))
    });
  }

  const allVehicles = await prisma.vehicle.findMany({ include: { customer: true } });
  await prisma.appointment.createMany({
    data: [
      { shopId: shop.id, customerId: allVehicles[0].customerId, vehicleId: allVehicles[0].id, technicianId: techs[0].id, scheduledAt: daysFromNow(1, 9), durationMinutes: 75, serviceName: "Oil change + tire rotation", estimatedRevenue: 155, estimatedJobHours: 1.2 },
      { shopId: shop.id, customerId: allVehicles[1].customerId, vehicleId: allVehicles[1].id, technicianId: techs[1].id, scheduledAt: daysFromNow(2, 13), durationMinutes: 150, serviceName: "Brake inspection", estimatedRevenue: 650, estimatedJobHours: 2.1 },
      { shopId: shop.id, customerId: allVehicles[2].customerId, vehicleId: allVehicles[2].id, technicianId: techs[0].id, scheduledAt: daysFromNow(5, 10), durationMinutes: 90, serviceName: "Coolant flush", estimatedRevenue: 180, estimatedJobHours: 1.5 }
    ]
  });

  const record = await prisma.serviceRecord.create({
    data: {
      shopId: shop.id,
      vehicleId: allVehicles[2].id,
      serviceDate: daysAgo(8),
      mileage: allVehicles[2].currentMileage,
      summary: "Oil change completed. Recommended rear shocks and cabin filter.",
      revenue: 90
    }
  });
  await prisma.deferredOpportunity.createMany({
    data: [
      { shopId: shop.id, vehicleId: allVehicles[2].id, serviceRecordId: record.id, description: "Rear shocks recommended", estimatedRevenue: 900, followUpDate: daysFromNow(14) },
      { shopId: shop.id, vehicleId: allVehicles[2].id, serviceRecordId: record.id, description: "Cabin filter recommended", estimatedRevenue: 55, followUpDate: daysFromNow(7) },
      { shopId: shop.id, vehicleId: allVehicles[0].id, description: "Front brakes recommended", estimatedRevenue: 650, followUpDate: daysFromNow(21) }
    ]
  });

  const oil = await prisma.inventoryItem.findFirstOrThrow({ where: { shopId: shop.id, barcode: "850001111001" } });
  const cleaner = await prisma.inventoryItem.findFirstOrThrow({ where: { shopId: shop.id, barcode: "850001111003" } });
  await prisma.inventoryScanLog.createMany({
    data: [
      { shopId: shop.id, inventoryItemId: oil.id, quantityUsed: 6, barcode: oil.barcode, scannedBy: "Mia Chen", scannedAt: daysAgo(3) },
      { shopId: shop.id, inventoryItemId: oil.id, quantityUsed: 8, barcode: oil.barcode, scannedBy: "Luis Ortega", scannedAt: daysAgo(12) },
      { shopId: shop.id, inventoryItemId: cleaner.id, quantityUsed: 4, barcode: cleaner.barcode, scannedBy: "Mia Chen", scannedAt: daysAgo(6) }
    ]
  });

  console.log("Seeded Maintiva demo data.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
