# Coworking SaaS (MVP)

Multi-tenant coworking-space management platform — web app + REST API.
Har coworking company ka apna isolated workspace (tenant); 9 roles with RBAC;
members, contracts, auto-billing, finance, attendance, tasks, meeting-room
bookings, reminders aur reports — sab kuch.
Space hierarchy: Tenant → Building → Floor → Zone → Unit (multiple
buildings per company supported).

## Stack

| Layer   | Tech |
|---------|------|
| API     | Node 20 + Express (plain JS) + Prisma + PostgreSQL |
| Web     | Next.js 14 (App Router, JS) + Tailwind CSS |
| Auth    | JWT access (15m) + refresh (7d), bcrypt password hashing, zod validation |
| Dev DB  | Docker Compose → PostgreSQL 16 |

## Prerequisites

- Node.js 20+ (`node --version`)
- Docker + Docker Compose (for PostgreSQL) — ya local PostgreSQL 14+

## Quick start

```bash
# 1. Database shuru karo
docker compose up -d

# 2. Dependencies install karo (root se — dono apps install ho jayengi)
npm install

# 3. API ke environment variables
cp apps/api/.env.example apps/api/.env
# .env me DATABASE_URL aur JWT secrets apne mutabiq set karo

# 4. Database migrate karo (apps/api se)
cd apps/api
npx prisma migrate dev --name init

# 5. Demo data seed karo
npm run seed
cd ../..

# 6. Web app ke environment variables
cp apps/web/.env.example apps/web/.env.local

# 7. Dono apps ek sath chalao (root se)
npm run dev
```

- API: http://localhost:4000/api/health
- Web: http://localhost:3000 → `/login`

Alag alag chalana ho to: `npm run dev:api` aur `npm run dev:web`.

## Demo logins (password sab ka: `demo1234`)

| Email | Role |
|---|---|
| `superadmin@coworking.app` | Super Admin (SaaS owner — tenants manage karta hai) |
| `ceo@demo.com` | CEO |
| `admin@demo.com` | Admin |
| `ops@demo.com` | Operations Manager |
| `manager@demo.com` | Manager |
| `finance@demo.com` | Finance Officer |
| `reception@demo.com` | Receptionist |
| `officeboy@demo.com` | Office Boy |
| `member@demo.com` | Member (limited portal: apne invoices, bookings, contract) |

Seed me "Demo Coworking" tenant banta hai: 2 buildings (Gulberg Campus,
DHA Campus), 2 floors, 4 zones, 21 units
(hot desks, dedicated desks, cabins, meeting rooms, phone booth), 8 members
with active contracts, invoices + payments, expenses, attendance, leaves,
tasks, bookings aur notifications.

## Project structure

```
coworking-saas/
├── docker-compose.yml          # PostgreSQL 16 (local dev)
├── package.json                # npm workspaces + concurrently dev script
├── apps/
│   ├── api/                    # Express REST API
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # 17 models, multi-tenant (har table me tenantId)
│   │   │   ├── seed.js         # demo tenant + users + data
│   │   │   └── migrations/     # Prisma migrations
│   │   └── src/
│   │       ├── server.js       # app bootstrap (TZ=UTC, routes, error handler)
│   │       ├── lib/            # prisma client, auth (JWT/bcrypt), tenant helpers, notify
│   │       ├── middleware/     # authenticate, requireRole, requireTenantUser, zod validate
│   │       └── routes/         # auth, tenants, users, dashboard, spaces, members,
│   │                           # contracts, billing, finance, attendance, tasks,
│   │                           # bookings, notifications, reports, settings
│   └── web/                    # Next.js 14 frontend
│       ├── app/
│       │   ├── login/page.js
│       │   └── (app)/          # protected layout: dashboard, spaces, members,
│       │                       # billing, finance, attendance, tasks, bookings,
│       │                       # reminders, reports, settings, users
│       ├── components/         # Sidebar (role-based), Topbar, ui kit
│       ├── context/AuthContext.js
│       └── lib/api.js          # fetch wrapper: Bearer token + auto refresh
```

## API overview (base `/api`)

- `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`
- `GET /dashboard/stats` — role-based (member ko sirf apna data)
- `GET/POST/PATCH/DELETE /users`, `/tenants` (super_admin)
- `/buildings` CRUD (floors yahan se link hote hain)
- `/spaces/floors|zones|units` CRUD + `GET /spaces/occupancy` (`?buildingId` filter, floors include building)
- `/members`, `/contracts` CRUD
- `/billing/invoices`, `POST /billing/invoices/generate {month}`, `/billing/dues`,
  `POST /billing/payments`, `/invoices/:id/cancel`
- `/finance/expenses` CRUD, `GET /finance/pnl?month=YYYY-MM`
- `/attendance/check-in|check-out`, `/attendance/records`, `/attendance/leaves`
- `/tasks` CRUD + `PATCH /tasks/:id/status`
- `/bookings` CRUD (meeting rooms only, overlap → 409)
- `/notifications`, `PATCH /notifications/:id/read`, `POST /notifications/generate`
- `/reports/occupancy|revenue|dues-aging`, `/settings`

Multi-tenancy: JWT me `tenantId` hota hai; har query us se scoped hai.
`super_admin` ka koi tenant nahi — wo sirf `/tenants` chalata hai.

WhatsApp/SMS: `src/lib/notify.js` me provider interface hai —
`WHATSAPP_PROVIDER` set nahi to console-log fallback chalta hai (MVP).

## Notes

- Tamam business dates UTC calendar days me handle hoti hain
  (`process.env.TZ='UTC'` server.js me pinned hai).
- Amounts Prisma `Decimal` hain — JSON me strings ki surat me ati hain;
  frontend `parseFloat` se handle karta hai.

## Troubleshooting

- **Prisma engine download fail ho** (proxy/network): `npm install --ignore-scripts`
  karo, phir engines manually `~/.cache/prisma/...` me rakho ya ye env vars set karo:
  `PRISMA_QUERY_ENGINE_BINARY`, `PRISMA_QUERY_ENGINE_LIBRARY`,
  `PRISMA_SCHEMA_ENGINE_BINARY`.

---

## Khulasa (Roman Urdu)

Ye **Coworking SaaS ka mukammal MVP source code** hai — sirf design ya PDF nahi,
asal chalta hua product:

- **9 roles:** Super Admin, CEO, Admin, Operations Manager, Manager,
  Finance Officer, Receptionist, Office Boy, Member — har ek ka apna dashboard
  aur permissions.
- **Modules:** Space management (buildings/floors/zones/units), members, contracts,
  auto monthly invoices, payments/receipts, dues, finance ledger + P&L,
  staff attendance + leaves, office boy tasks, meeting room bookings
  (overlap check ke sath), rent/contract-expiry reminders, reports
  (occupancy, revenue, dues aging), settings.
- **Multi-tenant:** ek hi software par multiple coworking companies —
  har company ka data bilkul alag.
- **Chalane ka tareeqa:** upar Quick start me 7 commands hain —
  `docker compose up -d`, `npm install`, `npx prisma migrate dev`,
  `npm run seed`, `npm run dev`. Phir browser me `localhost:3000` kholo
  aur demo login se andar jao (password: `demo1234`).

<!-- Cloudflare Pages now deploys straight from git (native GitHub integration). -->

<!-- pages-git-trigger 2026-10-05 -->

<!-- deploy-verify trigger 20:10 PKT -->
