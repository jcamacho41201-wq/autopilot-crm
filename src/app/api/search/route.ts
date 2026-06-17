import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { dateLabel, money } from "@/lib/format";
import { prisma } from "@/lib/prisma";

function contains(query: string) {
  return { contains: query, mode: "insensitive" as const };
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  if (query.length < 2) return NextResponse.json({ results: [] });

  const numericQuery = Number(query.replace(/[^\d]/g, ""));
  const mileageMatch = Number.isFinite(numericQuery) && numericQuery > 0 ? Math.round(numericQuery) : null;

  const [customers, vehicles, appointments, records, maintenance, services, quotes] = await Promise.all([
    prisma.customer.findMany({
      where: {
        shopId: user.shopId,
        OR: [
          { name: contains(query) },
          { phone: contains(query) },
          { email: contains(query) }
        ]
      },
      take: 6,
      orderBy: { updatedAt: "desc" }
    }),
    prisma.vehicle.findMany({
      where: {
        customer: { shopId: user.shopId },
        OR: [
          { make: contains(query) },
          { model: contains(query) },
          { trim: contains(query) },
          { vin: contains(query) },
          { licensePlate: contains(query) },
          ...(mileageMatch ? [{ year: mileageMatch }] : [])
        ]
      },
      include: { customer: true },
      take: 6,
      orderBy: { updatedAt: "desc" }
    }),
    prisma.appointment.findMany({
      where: {
        shopId: user.shopId,
        OR: [
          { serviceName: contains(query) },
          { notes: contains(query) },
          { customer: { name: contains(query) } },
          { vehicle: { make: contains(query) } },
          { vehicle: { model: contains(query) } }
        ]
      },
      include: { customer: true, vehicle: true },
      take: 6,
      orderBy: { scheduledAt: "asc" }
    }),
    prisma.serviceRecord.findMany({
      where: {
        shopId: user.shopId,
        OR: [
          { summary: contains(query) },
          { notes: contains(query) },
          { nextRecommendedService: contains(query) },
          { customer: { name: contains(query) } },
          { vehicle: { make: contains(query) } },
          { vehicle: { model: contains(query) } }
        ]
      },
      include: { customer: true, vehicle: true },
      take: 6,
      orderBy: { serviceDate: "desc" }
    }),
    prisma.maintenanceItem.findMany({
      where: {
        vehicle: { customer: { shopId: user.shopId } },
        OR: [
          { name: contains(query) },
          { customNotes: contains(query) },
          { vehicle: { make: contains(query) } },
          { vehicle: { model: contains(query) } },
          { vehicle: { vin: contains(query) } },
          { vehicle: { licensePlate: contains(query) } },
          { vehicle: { customer: { name: contains(query) } } }
        ]
      },
      include: { vehicle: { include: { customer: true } } },
      take: 6,
      orderBy: { name: "asc" }
    }),
    prisma.service.findMany({
      where: {
        shopId: user.shopId,
        OR: [
          { name: contains(query) },
          { category: contains(query) },
          { description: contains(query) },
          { recommendedNotes: contains(query) }
        ]
      },
      take: 6,
      orderBy: [{ category: "asc" }, { name: "asc" }]
    }),
    prisma.quote.findMany({
      where: {
        shopId: user.shopId,
        OR: [
          { quoteNumber: contains(query) },
          { status: contains(query) },
          { customer: { name: contains(query) } },
          { vehicle: { make: contains(query) } },
          { vehicle: { model: contains(query) } }
        ]
      },
      include: { customer: true, vehicle: true },
      take: 6,
      orderBy: { updatedAt: "desc" }
    })
  ]);

  const results = [
    ...customers.map((customer) => ({
      id: customer.id,
      category: "Customers",
      title: customer.name,
      subtitle: [customer.phone, customer.email].filter(Boolean).join(" · "),
      href: `/app/customers/${customer.id}`
    })),
    ...vehicles.map((vehicle) => ({
      id: vehicle.id,
      category: "Vehicles",
      title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      subtitle: `${vehicle.customer.name} · VIN ${vehicle.vin ?? "not set"} · Plate ${vehicle.licensePlate ?? "not set"}`,
      href: `/app/customers/${vehicle.customerId}/vehicles/${vehicle.id}`
    })),
    ...appointments.map((appointment) => ({
      id: appointment.id,
      category: "Appointments",
      title: `${appointment.serviceName} - ${dateLabel(appointment.scheduledAt)}`,
      subtitle: `${appointment.customer.name} · ${appointment.vehicle.year} ${appointment.vehicle.make} ${appointment.vehicle.model} · ${money.format(appointment.estimatedRevenue)}`,
      href: "/app/calendar"
    })),
    ...records.map((record) => ({
      id: record.id,
      category: "Service Records",
      title: record.summary,
      subtitle: `${record.customer?.name ?? "Customer"} · ${dateLabel(record.serviceDate)} · ${money.format(record.revenue)}`,
      href: `/app/customers/${record.vehicle.customerId}/vehicles/${record.vehicleId}`
    })),
    ...maintenance.map((item) => ({
      id: item.id,
      category: "Maintenance",
      title: item.name,
      subtitle: `${item.vehicle.customer.name} · ${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model} · ${money.format(item.averagePrice)}`,
      href: `/app/customers/${item.vehicle.customerId}/vehicles/${item.vehicleId}#maintenance-schedule`
    })),
    ...services.map((service) => ({
      id: service.id,
      category: "Services",
      title: service.name,
      subtitle: `${service.category} · ${money.format(service.averagePrice)} · ${service.defaultMileageInterval.toLocaleString()} mi`,
      href: "/app/settings/service-library"
    })),
    ...quotes.map((quote) => ({
      id: quote.id,
      category: "Quotes",
      title: `${quote.quoteNumber} · ${quote.status}`,
      subtitle: `${quote.customer.name} · ${quote.vehicle.year} ${quote.vehicle.make} ${quote.vehicle.model} · ${money.format(quote.total)}`,
      href: `/app/quotes/${quote.id}`
    }))
  ].slice(0, 24);

  return NextResponse.json({ results });
}
