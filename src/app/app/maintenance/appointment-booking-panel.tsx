"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CalendarPlus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createAppointmentAction } from "@/lib/actions";

type BookingService = {
  id: string;
  name: string;
  category?: string | null;
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
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [notes, setNotes] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredServices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return services;
    return services.filter((service) => {
      const searchable = [
        service.name,
        service.status,
        service.category ?? "",
        String(service.estimatedPrice),
        money.format(service.estimatedPrice)
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [searchQuery, services]);
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

  function openModal() {
    setSelectedServiceIds([]);
    setSearchQuery("");
    setScheduledAt(defaultScheduledAt);
    setNotes("");
    setError("");
    setIsOpen(true);
  }

  function closeModal() {
    if (isPending) return;
    setIsOpen(false);
    setSelectedServiceIds([]);
    setSearchQuery("");
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm || isPending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      void (async () => {
        try {
          setError("");
          await createAppointmentAction(formData);
          setIsOpen(false);
          setSelectedServiceIds([]);
          setSearchQuery("");
          setNotes("");
          setShowSuccess(true);
          router.refresh();
        } catch {
          setError("Unable to book this appointment. Please try again.");
        }
      })();
    });
  }

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        setIsOpen(false);
        setSelectedServiceIds([]);
        setSearchQuery("");
        setError("");
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isPending]);

  useEffect(() => {
    if (!showSuccess) return;
    const timeout = window.setTimeout(() => setShowSuccess(false), 3500);
    return () => window.clearTimeout(timeout);
  }, [showSuccess]);

  return (
    <>
      <button className="button secondary" type="button" onClick={openModal}><CalendarPlus /> {label}</button>
      {showSuccess ? <div className="toast-success">Appointment booked successfully</div> : null}

      {isOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="appointment-modal" role="dialog" aria-modal="true" aria-labelledby={`appointment-modal-${vehicleId}`}>
            <div className="appointment-modal-header">
              <div>
                <h2 id={`appointment-modal-${vehicleId}`}>Book Appointment</h2>
                <p>{vehicleLabel}</p>
              </div>
              <button className="icon-button modal-close-button" type="button" aria-label="Close appointment booking" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <form className="form appointment-booking-panel" onSubmit={handleSubmit}>
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="vehicleId" value={vehicleId} />
              <input type="hidden" name="estimatedDurationMinutes" value={45} />

              <section className="modal-section">
                <h3>Search Services</h3>
                <label className="search-control">
                  <Search size={18} />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    placeholder="Search services..."
                  />
                </label>
              </section>

              <section className="modal-section">
                <h3>Select Services</h3>
                <div className="checkbox-grid appointment-service-selector">
                  {filteredServices.length ? filteredServices.map((service) => (
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
                  )) : <p>No matching services found.</p>}
                </div>
              </section>

              <section className="modal-section">
                <h3>Appointment Summary</h3>
                <div className="appointment-selection-summary">
                  {selectedServices.length ? (
                    <>
                      <strong>{selectedServices.length} service{selectedServices.length === 1 ? "" : "s"} selected</strong>
                      <span>{money.format(selectedTotalPrice)} total</span>
                      <span>{durationLabel(selectedTotalDuration)} estimated</span>
                    </>
                  ) : <span>No services selected yet.</span>}
                </div>
              </section>

              <section className="modal-section">
                <h3>Date / Time</h3>
                <label>Date/time
                  <input
                    name="scheduledAt"
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.currentTarget.value)}
                    required
                  />
                </label>
              </section>

              <section className="modal-section">
                <h3>Technician</h3>
                <label>Technician
                  <select name="technicianId" defaultValue="">
                    <option value="">Unassigned</option>
                    {technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
                  </select>
                </label>
              </section>

              <section className="modal-section">
                <h3>Notes</h3>
                <label>Notes
                  <textarea
                    name="notes"
                    value={notes}
                    onChange={(event) => setNotes(event.currentTarget.value)}
                    placeholder="Appointment notes..."
                  />
                </label>
              </section>

              {error ? <p className="badge danger" style={{ whiteSpace: "normal" }}>{error}</p> : null}
              {!selectedServiceIds.length ? <p className="muted">Select at least one service to book this appointment.</p> : null}
              <button className="button" type="submit" disabled={!canConfirm || isPending}>
                <CalendarPlus /> {isPending ? "Booking..." : "Confirm Appointment"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
