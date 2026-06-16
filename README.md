# AutoPilot CRM

AutoPilot CRM is a working SaaS MVP for independent auto repair shops. It tracks customers, vehicles, service mileage, predictive maintenance, reminders, appointments, inventory scans, deferred work, revenue forecasts, and simple technician efficiency.

## Run locally

Use PostgreSQL locally or connect to the same Vercel/Prisma Postgres database.

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Demo login:

- Email: `owner@autopilot.local`
- Password: `password123`

The public booking demo URL is `/booking/demo-auto-care`.

## Vercel deployment

Set these environment variables in Vercel before deploying:

- `DATABASE_URL`: your Postgres connection string from Vercel Storage / Prisma Postgres.
- `APP_URL`: your Vercel app URL.
- `SESSION_SECRET`: a long random string.
- `SMS_API_KEY`: optional; leave blank for mock reminders.

Vercel uses `pnpm vercel-build`, which runs:

```bash
prisma generate && prisma migrate deploy && next build
```

That applies committed Prisma migrations to the production Postgres database before the app is built.

## SaaS-ready structure

- Multi-tenant schema: every operational record is scoped to a shop.
- Auth: cookie sessions backed by the database.
- Roles: owner/admin and mechanic/staff.
- Stripe-ready: shop plans and subscription status are modeled without payment integration.
- SMS-ready: reminders log mock sends unless `SMS_API_KEY` is configured.
