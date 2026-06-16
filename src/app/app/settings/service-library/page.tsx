import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { maintenancePrediction, type MaintenanceWithVehicle } from "@/lib/predictions";
import { ServiceLibraryClient, type PackageRow, type ServiceRow } from "./service-library-client";

const fallbackCategories = [
  "Fluids",
  "Brakes",
  "Filters",
  "Engine",
  "Cooling System",
  "Suspension",
  "Electrical",
  "Inspection",
  "Custom"
];

export default async function ServiceLibraryPage({
  searchParams
}: {
  searchParams: { error?: string; success?: string };
}) {
  const user = await requireUser();
  const [services, packages] = await Promise.all([
    prisma.service.findMany({
      where: { shopId: user.shopId },
      include: {
        maintenanceItems: {
          include: { vehicle: { include: { customer: true, mileageLogs: true } } }
        },
        packageItems: true
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    }),
    prisma.servicePackage.findMany({
      where: { shopId: user.shopId },
      include: { items: { include: { service: true } } },
      orderBy: { name: "asc" }
    })
  ]);

  const serviceRows: ServiceRow[] = services.map((service) => {
    const rows = service.maintenanceItems.map((item) => ({
      item,
      prediction: maintenancePrediction(item as MaintenanceWithVehicle)
    }));
    const assigned = new Set(service.maintenanceItems.map((item) => item.vehicleId)).size;
    const dueSoon = rows.filter((row) => row.prediction.status === "Due" || row.prediction.status === "Due Soon").length;
    const overdue = rows.filter((row) => row.prediction.status === "Overdue").length;
    const projectedRevenue = rows
      .filter((row) => row.prediction.status === "Overdue" || row.prediction.status === "Due" || row.prediction.status === "Due Soon")
      .reduce((sum, row) => sum + row.item.averagePrice, 0);
    const overdueRevenue = rows
      .filter((row) => row.prediction.status === "Overdue")
      .reduce((sum, row) => sum + row.item.averagePrice, 0);
    const conversionRate = assigned ? Math.max(0, Math.round(((assigned - overdue) / assigned) * 100)) : 0;
    return {
      id: service.id,
      name: service.name,
      category: service.category,
      defaultMileageInterval: service.defaultMileageInterval,
      defaultTimeIntervalMonths: service.defaultTimeIntervalMonths,
      averagePrice: service.averagePrice,
      defaultReminderThreshold: service.defaultReminderThreshold,
      description: service.description,
      recommendedNotes: service.recommendedNotes,
      status: service.status,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
      assigned,
      dueSoon,
      overdue,
      projectedRevenue,
      overdueRevenue,
      conversionRate,
      packageCount: service.packageItems.length
    };
  });

  const serviceById = new Map(serviceRows.map((service) => [service.id, service]));
  const packageRows: PackageRow[] = packages.map((servicePackage) => {
    const serviceIds = servicePackage.items.map((item) => item.serviceId);
    const serviceNames = servicePackage.items.map((item) => item.service.name);
    const packageServices = serviceIds.map((id) => serviceById.get(id)).filter(Boolean) as ServiceRow[];
    const projectedRevenue = packageServices.reduce((sum, service) => sum + service.projectedRevenue, 0);
    const packageVehicles = new Set<string>();
    servicePackage.items.forEach((item) => {
      const source = services.find((service) => service.id === item.serviceId);
      source?.maintenanceItems.forEach((maintenanceItem) => packageVehicles.add(maintenanceItem.vehicleId));
    });
    return {
      id: servicePackage.id,
      name: servicePackage.name,
      description: servicePackage.description,
      status: servicePackage.status,
      serviceIds,
      serviceNames,
      servicesIncluded: serviceIds.length,
      vehiclesUsingPackage: packageVehicles.size,
      projectedRevenue
    };
  });

  const categories = Array.from(new Set([...fallbackCategories, ...serviceRows.map((service) => service.category)])).sort();
  const totalRevenueOpportunity = serviceRows.reduce((sum, service) => sum + service.projectedRevenue, 0);
  const totalOverdueRevenue = serviceRows.reduce((sum, service) => sum + service.overdueRevenue, 0);
  const mostUsed = [...serviceRows].sort((a, b) => b.assigned - a.assigned)[0] ?? null;
  const highestRevenue = [...serviceRows].sort((a, b) => b.projectedRevenue - a.projectedRevenue)[0] ?? null;
  const mostOverdue = [...serviceRows].sort((a, b) => b.overdue - a.overdue)[0] ?? null;
  const highestConversion = [...serviceRows].filter((service) => service.assigned > 0).sort((a, b) => b.conversionRate - a.conversionRate)[0] ?? null;
  const totalVehiclesCovered = new Set(services.flatMap((service) => service.maintenanceItems.map((item) => item.vehicleId))).size;

  return (
    <ServiceLibraryClient
      categories={categories}
      error={searchParams.error}
      highestConversion={highestConversion}
      highestRevenue={highestRevenue}
      mostOverdue={mostOverdue}
      mostUsed={mostUsed}
      packages={packageRows}
      services={serviceRows}
      success={searchParams.success}
      totals={{
        activeServices: serviceRows.filter((service) => service.status === "ACTIVE").length,
        totalOverdueRevenue,
        totalRevenueOpportunity,
        totalServices: serviceRows.length,
        totalVehiclesCovered
      }}
    />
  );
}
