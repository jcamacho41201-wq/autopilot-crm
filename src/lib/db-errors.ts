export function databaseErrorMessage(error: unknown) {
  const candidate = error as { code?: string; message?: string; meta?: { modelName?: string; column?: string } };
  const message = candidate?.message ?? "";
  if (candidate?.code === "P2022" || message.includes("does not exist in the current database")) {
    const column = candidate.meta?.column ? ` Missing column: ${candidate.meta.column}.` : "";
    return `Database schema is out of date.${column} Run Prisma migrations on the production database and redeploy.`;
  }
  if (candidate?.code === "P2021") {
    return "Database tables are missing. Run Prisma migrations on the production database and redeploy.";
  }
  if (candidate?.code === "P1001" || candidate?.code === "P1012" || message.includes("Invalid prisma")) {
    return "The app cannot connect to the database. Check DATABASE_URL in Vercel.";
  }
  return "A database error occurred while loading this page. Check Vercel logs and database migrations.";
}

export function isDatabaseError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  return Boolean(
    candidate?.code?.startsWith("P") ||
      candidate?.message?.includes("database") ||
      candidate?.message?.includes("Prisma") ||
      candidate?.message?.includes("does not exist")
  );
}
