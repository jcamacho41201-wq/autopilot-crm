"use client";

import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { createAppointmentAction } from "@/lib/actions";

type BookingService = {
  id: string;
  name: string;
  status: string;
  statusTone: string;
  estimatedPrice: number;
  estimatedDurationMinutes: number;
};

type TechnicianOption = {
  id: string;
  name: string;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(2)} hours`;
}

export function AppointmentBookingPanel({
  customerId,
  vehicleId,
  services,
  technicians,
  defaultScheduledAt,
  vehicleLabel,
  label = "Book Appointment"
}: {
  customerId: string;
  vehicleId: string;
  services: BookingService[];
  technicians: TechnicianOption[];
  defaultScheduledAt: string;
  vehicleLabel: string;
  label?: string;
}) {
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);

  const selectedServices = useMemo(
    () => services.filter((service) => selectedServiceIds.includes(service.id)),
    [selectedServiceIds, services]
  );
  const selectedTotalPrice = selectedServices.reduce((sum, service) => sum + service.estimatedPrice, 0);
  const selectedTotalDuration = selectedServices.reduce((sum, service) => sum + service.estimatedDurationMinutes, 0);
  const canConfirm = Boolean(customerId && vehicleId && scheduledAt && selectedServiceIds.length);

  function toggleService(serviceId: string, checked: boolean) {
    setSelectedServiceIds((current) =>
      checked ? [...current, serviceId] : current.filter((id) => id !== serviceId)
    );
  }

  return (
    <details
      className="inline-details appointment-booking-details"
      onToggle={(event) => {
        if (event.currentTarget.open) setSelectedServiceIds([]);
      }}
    >
      <summary className="button secondary"><CalendarPlus /> {label}</summary>
      <form className="form compact-form appointment-booking-panel" action={createAppointmentAction}>
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="vehicleId" value={vehicleId} />
        <input type="hidden" name="estimatedDurationMinutes" value={45} />

        <div>
          <h3>Select Services</h3>
          <p className="muted">{vehicleLabel}</p>
        </div>

        <div className="checkbox-grid appointment-service-selector">
          {services.length ? services.map((service) => (
            <label className="checkbox-row appointment-service-row" key={service.id}>
              <input
                type="checkbox"
                name="maintenanceIds"
                value={service.id}
                checked={selectedServiceIds.includes(service.id)}
                onChange={(event) => toggleService(service.id, event.currentTarget.checked)}
              />
              <span className="appointment-service-main">
                <strong>{service.name}</strong>
                <span className={`badge ${service.statusTone}`}>{service.status}</span>
              </span>
              <span>{money.format(service.estimatedPrice)}</span>
              <span>{service.estimatedDurationMinutes} min</span>
            </label>
          )) : <p>No assigned services are available for this vehicle yet.</p>}
        </div>

        <div className="appointment-selection-summary">
          {selectedServices.length ? (
            <>
              <strong>{selectedServices.length} service{selectedServices.length === 1 ? "" : "s"} selected</strong>
              <span>{money.format(selectedTotalPrice)} total</span>
              <span>{durationLabel(selectedTotalDuration)} estimated</span>
            </>
          ) : <span>No services selected yet.</span>}
        </div>

        <label>Date/time
          <input
            name="scheduledAt"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.currentTarget.value)}
            required
          />
        </label>
        <label>Technician
          <select name="technicianId" defaultValue="">
            <option value="">Unassigned</option>
            {technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
          </select>
        </label>
        <label>Notes
          <textarea name="notes" placeholder="Optional appointment notes" />
        </label>

        <button className="button" type="submit" disabled={!canConfirm}>
          <CalendarPlus /> Confirm Appointment
        </button>
      </form>
    </details>
  );
}
