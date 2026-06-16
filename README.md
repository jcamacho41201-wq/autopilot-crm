# AutoPilot CRM

AutoPilot CRM is a working SaaS MVP for independent auto repair shops. It tracks customers, vehicles, service mileage, predictive maintenance, reminders, appointments, inventory scans, deferred work, revenue forecasts, and simple technician efficiency.

## Run locally

```bash
cp .env.example .env
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

Demo login:

- Email: `owner@autopilot.local`
- Password: `password123`

The public booking demo URL is `/booking/demo-auto-care`.

## SaaS-ready structure

- Multi-tenant schema: every operational record is scoped to a shop.
- Auth: cookie sessions backed by the database.
- Roles: owner/admin and mechanic/staff.
- Stripe-ready: shop plans and subscription status are modeled without payment integration.
- SMS-ready: reminders log mock sends unless `SMS_API_KEY` is configured.
