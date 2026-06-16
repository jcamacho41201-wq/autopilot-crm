-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceItem" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "MaintenanceItem" ADD COLUMN "overrideDueMileage" INTEGER;
ALTER TABLE "MaintenanceItem" ADD COLUMN "overrideDueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ServiceRecord" ADD COLUMN "notes" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "nextRecommendedService" TEXT;
ALTER TABLE "ServiceRecord" ADD COLUMN "nextRecommendedMileage" INTEGER;
