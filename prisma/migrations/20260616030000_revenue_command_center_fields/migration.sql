-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "lifetimeSpend" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "trim" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "mileageUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "technicianId" TEXT;

-- AlterTable
ALTER TABLE "ReminderRule" ADD COLUMN "messageTemplate" TEXT;

-- AlterTable
ALTER TABLE "ReminderLog" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ReminderLog" ADD COLUMN "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceItem" ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Technician" ADD COLUMN "hourlyRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Technician" ADD COLUMN "reworkCount" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;
