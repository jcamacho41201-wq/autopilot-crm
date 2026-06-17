CREATE TABLE "AppointmentService" (
  "id" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "serviceTemplateId" TEXT,
  "maintenanceItemId" TEXT,
  "serviceName" TEXT NOT NULL,
  "estimatedPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "estimatedDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppointmentService_appointmentId_idx" ON "AppointmentService"("appointmentId");
CREATE INDEX "AppointmentService_maintenanceItemId_idx" ON "AppointmentService"("maintenanceItemId");
CREATE INDEX "AppointmentService_serviceTemplateId_idx" ON "AppointmentService"("serviceTemplateId");

ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceTemplateId_fkey" FOREIGN KEY ("serviceTemplateId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_maintenanceItemId_fkey" FOREIGN KEY ("maintenanceItemId") REFERENCES "MaintenanceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "AppointmentService" (
  "id",
  "appointmentId",
  "serviceName",
  "estimatedPrice",
  "estimatedDurationMinutes",
  "status",
  "createdAt"
)
SELECT
  concat('legacy_', "id"),
  "id",
  "serviceName",
  "estimatedRevenue",
  "durationMinutes",
  CASE WHEN "status" = 'COMPLETED' THEN 'COMPLETED' ELSE 'SCHEDULED' END,
  CURRENT_TIMESTAMP
FROM "Appointment";
