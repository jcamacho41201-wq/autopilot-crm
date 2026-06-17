import type { Appointment, AppointmentService, Customer, Technician, Vehicle } from "@prisma/client";

export type AppointmentWithRelations = Appointment & {
  customer?: Customer | null;
  vehicle?: Vehicle | null;
  technician?: Technician | null;
  services?: AppointmentService[];
};

export type VehicleVisitAppointment = AppointmentWithRelations & {
  appointmentIds: string[];
  primaryAppointmentId: string;
  visitKey: string;
  serviceCount: number;
  totalValue: number;
  totalDurationMinutes: number;
  primaryService: string;
  remainingServicesCount: number;
  displayServiceSummary: string;
  displayDuration: string;
  services: AppointmentService[];
};

export function displayDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} Hours`;
}

function serviceStatusForAppointment(status: string) {
  return status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "SCHEDULED";
}

function servicesForAppointment(appointment: AppointmentWithRelations): AppointmentService[] {
  if (appointment.services?.length) return appointment.services;
  return [
    {
      id: `legacy-${appointment.id}`,
      appointmentId: appointment.id,
      serviceTemplateId: null,
      maintenanceItemId: null,
      serviceName: appointment.serviceName || "Vehicle service",
      estimatedPrice: appointment.estimatedRevenue || 0,
      estimatedDurationMinutes: appointment.durationMinutes || 60,
      status: serviceStatusForAppointment(appointment.status),
      createdAt: appointment.createdAt
    }
  ];
}

function appointmentVisitKey(appointment: AppointmentWithRelations) {
  return `${appointment.customerId}:${appointment.vehicleId}:${appointment.scheduledAt.toISOString()}`;
}

function serviceIdentity(service: AppointmentService) {
  return service.maintenanceItemId || `${service.serviceName}:${service.estimatedPrice}:${service.estimatedDurationMinutes}`;
}

export function getVehicleVisitAppointments(appointments: AppointmentWithRelations[]) {
  const groups = appointments.reduce((map, appointment) => {
    const key = appointmentVisitKey(appointment);
    const group = map.get(key) ?? [];
    group.push(appointment);
    map.set(key, group);
    return map;
  }, new Map<string, AppointmentWithRelations[]>());

  return Array.from(groups.entries())
    .map(([visitKey, group]) => {
      const sortedGroup = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const primary = sortedGroup[0];
      const uniqueServices = Array.from(
        sortedGroup
          .flatMap(servicesForAppointment)
          .reduce((map, service) => {
            const key = serviceIdentity(service);
            if (!map.has(key)) map.set(key, service);
            return map;
          }, new Map<string, AppointmentService>())
          .values()
      );
      const serviceCount = Math.max(1, uniqueServices.length);
      const totalValue = uniqueServices.reduce((sum, service) => sum + service.estimatedPrice, 0);
      const serviceDuration = uniqueServices.reduce((sum, service) => sum + service.estimatedDurationMinutes, 0);
      const totalDurationMinutes = serviceDuration || sortedGroup.reduce((sum, appointment) => sum + appointment.durationMinutes, 0) || 60;
      const primaryService = uniqueServices[0]?.serviceName ?? primary.serviceName ?? "Vehicle service";
      const remainingServicesCount = Math.max(0, serviceCount - 1);
      const displayServiceSummary = remainingServicesCount ? `${primaryService} + ${remainingServicesCount} more` : primaryService;

      return {
        ...primary,
        appointmentIds: sortedGroup.map((appointment) => appointment.id),
        primaryAppointmentId: primary.id,
        visitKey,
        serviceCount,
        totalValue,
        totalDurationMinutes,
        durationMinutes: totalDurationMinutes,
        estimatedRevenue: totalValue,
        serviceName: displayServiceSummary,
        primaryService,
        remainingServicesCount,
        displayServiceSummary,
        displayDuration: displayDuration(totalDurationMinutes),
        services: uniqueServices
      } satisfies VehicleVisitAppointment;
    })
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
