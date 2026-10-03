# CoworkOS — Complete System Architecture
**Version:** 1.0 | **Date:** 2026-10-03 | **Status:** Awaiting approval (Section 49 deliverable)

> Ye document Section 49 ke tamam 14 points cover karta hai. Approve hone ke baad Phase 1 implementation start hogi.

---

## 0. Starting Point — Kya Pehle Se Live Hai

Hamare paas **already production-live** product hai (Techub Co-Working):

| Layer | Live State |
|---|---|
| Frontend | https://techub-co-working.pages.dev (Next.js, dark premium UI) |
| Backend API | https://techub-api.150.230.52.29.sslip.io (Express + Prisma + PostgreSQL) |
| Multi-tenancy | ✅ `tenantId` har table par, har query tenant-scoped |
| RBAC | ✅ 9 roles (super_admin → member), granular, backend enforced |
| Modules live | Auth, Organizations, Branches (buildings), Units (desks/offices/rooms), Members, Companies, Memberships (contracts), Bookings, Invoices, Payments, Expenses, Tasks, Attendance, Notifications, Reports, Dashboard |

**Architecture decision:** Naya rewrite NAHI hoga. Live product ko **evolve** kiya jayega — yehi fastest aur safest rasta hai. Neeche har section me "Live ✅ / Banana hai 🆕" mark kiya gaya hai.

**Stack decision (spec ke "Preferred" par):**
- Frontend: Next.js (keep) + **TypeScript adopt incrementally** naye modules me + Tailwind (keep). shadcn/ui-style component discipline apnayi jayegi (poori library swap ki zaroorat nahi — existing `ui.js` design system already consistent hai).
- Backend: **Express + Prisma (keep)** — live, tested, modular. Service/repository pattern enforce hoga (neeche structure dekhein). NestJS/Laravel rewrite ka koi faida nahi — 6+ mahine ka kaam dobara karna hoga.
- DB: PostgreSQL (keep) | Infra: Docker (keep) + Redis 🆕 + S3-compatible storage 🆕

---

## 1. Complete System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│  Admin Web (Next.js)   Member Portal (Next.js)   Mobile (future, same API) │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────────┐
│                    NGINX (reverse proxy)                    │
│              Rate limiting · TLS · Static cache             │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                   API LAYER (Express)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐   │
│  │  Auth    │  │  Tenant  │  │  RBAC                    │   │
│  │  (JWT +  │  │  resolver│  │  (permission middleware) │   │
│  │  refresh)│  │  (every  │  │                          │   │
│  └──────────┘  │  request)│  └──────────────────────────┘   │
│                └──────────┘                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  MODULES (service / repository pattern)              │   │
│  │  members · companies · memberships · spaces ·        │   │
│  │  bookings · tickets 🆕 · maintenance 🆕 · visitors 🆕  │   │
│  │  finance · invoices · payments · expenses ·          │   │
│  │  inventory 🆕 · assets 🆕 · contracts · documents 🆕   │   │
│  │  staff · notifications · reports · audit 🆕 ·        │   │
│  │  saas-admin 🆕 · integrations 🆕                     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │  Queue   │  │  Cache   │  │  Storage │  │  Webhooks  │    │
│  │ (BullMQ) │  │ (Redis)  │  │ (S3)     │  │  🆕        │    │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              PostgreSQL (row-level tenant isolation)        │
│         tenant_id on every row · FK indexes · audit         │
└─────────────────────────────────────────────────────────────┘
```

**Key principles:**
- **Modular monolith** — ek deployable unit, andar modules alag (Section 44: "Do not create unnecessary microservices initially").
- **Tenant isolation backend par** — har query me `tenantId` mandatory (middleware se inject). Frontend filtering sirf UX hai, security nahi.
- **Coworking billing vs SaaS billing** — do alag domains, alag tables, alag code paths (Section 36).

---

## 2. Recommended Folder Structure (Monorepo)

```
coworking-saas/
├── apps/
│   ├── api/                          # Backend (Express + Prisma)
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # ✅ exists — extend hoga
│   │   │   ├── migrations/           # ✅ exists
│   │   │   └── seed*.js
│   │   └── src/
│   │       ├── app.js                # ✅ exists
│   │       ├── config/               # env, constants        ✅
│   │       ├── middleware/
│   │       │   ├── auth.js           # ✅ JWT verify
│   │       │   ├── tenant.js         # ✅ tenant resolver (extend)
│   │       │   ├── rbac.js           # ✅ permission check
│   │       │   ├── validate.js       # 🆕 zod/joi schemas
│   │       │   ├── rateLimit.js      # 🆕
│   │       │   └── audit.js          # 🆕 audit logger
│   │       ├── modules/              # 🆕 service/repository per module
│   │       │   ├── members/   { controller, service, repository, validators, tests }
│   │       │   ├── bookings/  { ... }
│   │       │   ├── tickets/   { ... }        # 🆕 complaints
│   │       │   ├── maintenance/ { ... }      # 🆕
│   │       │   ├── visitors/  { ... }        # 🆕
│   │       │   ├── inventory/ { ... }        # 🆕
│   │       │   ├── assets/    { ... }        # 🆕
│   │       │   ├── documents/ { ... }        # 🆕
│   │       │   ├── finance/   { invoices, payments, expenses }
│   │       │   ├── reports/   { ... }
│   │       │   └── saas/      { plans, subscriptions, feature-flags } # 🆕
│   │       ├── integrations/             # 🆕 modular: email, sms, whatsapp, webhooks
│   │       ├── jobs/                   # 🆕 queues: notifications, reminders, PDF
│   │       └── utils/
│   ├── web/                          # Frontend (Next.js)
│   │   ├── app/
│   │   │   ├── (auth)/ login, forgot-password 🆕, verify-email 🆕, 2fa 🆕
│   │   │   ├── (app)/                # ✅ exists — admin/staff routes
│   │   │   │   ├── dashboard/        # ✅ + charts
│   │   │   │   ├── members/ companies/ memberships/ spaces/
│   │   │   │   ├── bookings/         # ✅ + calendar views 🆕
│   │   │   │   ├── tickets/          # 🆕
│   │   │   │   ├── maintenance/      # 🆕
│   │   │   │   ├── visitors/         # 🆕
│   │   │   │   ├── finance/ invoices/ payments/ expenses/
│   │   │   │   ├── inventory/ assets/ contracts/ documents/  # 🆕
│   │   │   │   ├── staff/ attendance/
│   │   │   │   ├── reports/          # ✅ extend (exports 🆕)
│   │   │   │   ├── settings/
│   │   │   │   └── saas-admin/       # 🆕 super_admin only
│   │   │   └── (member)/             # 🆕 member portal layout
│   │   │       ├── m/dashboard, m/bookings, m/invoices, m/tickets, m/profile
│   │   ├── components/
│   │   │   ├── ui.js                 # ✅ design system (extend)
│   │   │   ├── charts/               # ✅ BarChart, DonutChart, TrendChart
│   │   │   ├── calendar/             # 🆕 booking calendar
│   │   │   └── floorplan/            # 🆕 visual floor plan
│   │   ├── lib/ { api.js ✅, auth ✅, permissions 🆕 }
│   │   └── context/ { AuthContext ✅ }
├── packages/
│   └── permissions/                  # 🆕 shared permission constants (API + Web)
├── deploy/
│   ├── single-container/             # ✅ exists (current prod)
│   └── full/                        # 🆕 docker-compose: api, web, postgres, redis, nginx
├── docs/                             # 🆕 README, API docs, runbooks
└── .env.example                      # ✅ exists — extend
```

---

## 3. Database ERD

```
                    ┌──────────────┐
                    │ ORGANIZATION │  (tenant)
                    │ id (PK)      │
                    └──────┬───────┘
                           │ 1:N
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐   ┌───────▼──────┐   ┌───────▼──────┐
│    BRANCH    │   │     USER     │   │    COMPANY   │
│ id, org_id   │   │ id, org_id   │   │ id, org_id   │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │ 1:N               │ N:M               │ 1:N
┌──────▼──────┐   ┌────────▼────────┐  ┌──────▼──────┐
│    FLOOR    │   │  ROLE ⇄ PERM    │  │   MEMBER    │
│ id, branch  │   │  user_roles     │  │ id, org_id  │
└──────┬──────┘   └─────────────────┘  │ company_id? │
       │ 1:N                           └──────┬──────┘
┌──────▼────────┐                              │ 1:N
│     SPACE     │◄─────────────┐       ┌───────▼────────┐
│ id, floor_id  │              │       │  MEMBERSHIP    │
│ type, status  │         ┌────┴───────▼──┐ (contract)   │
│ price         │         │    BOOKING    │ id, member   │
└──────┬────────┘         │ space, member │ plan_id      │
       │                  └───────────────┘ └──────┬───────┘
       │ 1:N                         ┌─────────────┘
┌──────▼────────┐  ┌──────────────────▼──────────────────┐
│  MAINT_ORDER  │  │              INVOICE                │
│ asset, space  │  │ id, member/company, membership      │
└──────┬────────┘  └──────┬──────────────┬───────────────┘
       │             1:N   │              │ 1:N
┌──────▼──────┐  ┌───────▼──────┐  ┌─────▼────────┐
│    ASSET    │  │ INVOICE_ITEM │  │   PAYMENT    │
│ id, branch  │  └──────────────┘  └──────────────┘
└─────────────┘
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│   TICKET    │  │    VISITOR   │  │  INVENTORY   │
│ member,     │  │ member host, │  │ item, branch │
│ assignee    │  │ branch       │  └──────────────┘
└──────┬──────┘  └──────────────┘  ┌──────────────┐
       │ 1:N                      │   EXPENSE    │
┌──────▼──────────┐               │ branch, cat  │
│ TICKET_COMMENT  │               └──────────────┘
│ TICKET_HISTORY  │  ┌──────────────┐  ┌──────────────┐
└─────────────────┘  │   DOCUMENT   │  │  AUDIT_LOG   │  (immutable)
                     │ polymorphic  │  │ who/what/when│
                     └──────────────┘  └──────────────┘
┌──────────────────────────────────────────────────┐
│ SaaS LAYER (platform only, NO org_id)             │
│ saas_plan · saas_subscription(org) · feature_flag │
└──────────────────────────────────────────────────┘
```

**Har business table par:** `id (UUID)`, `organizationId (FK)`, `createdAt`, `updatedAt`, `deletedAt?` (soft delete jahan zaroori).

---

## 4. Complete Database Tables

### Core / Tenancy ✅ (live)
| Table | Key columns | Status |
|---|---|---|
| `organizations` | id, name, logo_url, email, phone, address, country, currency, timezone, tax_no, invoice_settings (json), branding (json) | ✅ extend settings |
| `organization_settings` | org_id, key, value (json) | 🆕 |
| `branches` | id, org_id, name, code, address, phone, email, manager_id, opening_hours (json), status | ✅ (as buildings) |
| `floors` | id, org_id, branch_id, name, level, plan_data (json 🆕) | 🆕 |
| `spaces` | id, org_id, floor_id, name, code, type (hot_desk/dedicated_desk/private_office/meeting_room/conference/event), capacity, status, price, amenities (json), images (json), description | ✅ (as units — floor link 🆕) |

### Identity & Access ✅ (live, extend)
| Table | Key columns | Status |
|---|---|---|
| `users` | id, org_id, email (unique per org), password_hash, name, phone, photo, status, 2fa_secret 🆕, email_verified_at 🆕 | ✅ + 🆕 fields |
| `roles` | id, org_id (null = system), name, description | ✅ |
| `permissions` | id, key (e.g. `members.create`), description | 🆕 (abhi role-name based hai) |
| `role_permissions` | role_id, permission_id | 🆕 |
| `user_roles` | user_id, role_id, branch_id? (branch-scoped 🆕) | ✅ + branch scope |
| `sessions` | id, user_id, device_info, ip, expires_at, revoked | 🆕 |
| `password_resets` | user_id, token_hash, expires_at | 🆕 |

### Members & Companies ✅ (live, extend)
| Table | Key columns | Status |
|---|---|---|
| `companies` | id, org_id, name, reg_no, contact_person, email, phone, address, billing_info (json) | ✅ (extend) |
| `members` | id, org_id, company_id?, full_name, photo, email, phone, job_title, id_number, emergency_contact (json), address, joining_date, status, notes | ✅ (extend: photo, id_number, emergency) |
| `membership_plans` | id, org_id, name, price, billing_cycle, included_hours, credits, access_hours, max_users, features (json), deposit, setup_fee, tax_rate | 🆕 (abhi contracts me embedded) |
| `memberships` | id, org_id, member_id, plan_id, space_id?, start_date, end_date, status, auto_renew | ✅ (as contracts — plan link 🆕) |

### Bookings ✅ (live, extend)
| Table | Key columns | Status |
|---|---|---|
| `bookings` | id, org_id, branch_id, space_id, member_id, title, start_time, end_time, status (pending/confirmed/checked_in/completed/cancelled/no_show), notes | ✅ + status enum 🆕 |
| `booking_rules` | id, org_id, space_type, min_duration, max_duration, advance_days, buffer_minutes | 🆕 |

### Tickets 🆕 (poora naya module)
| Table | Key columns |
|---|---|
| `tickets` | id, org_id, number (auto, e.g. T-0001), member_id, company_id?, branch_id, floor_id?, space_id?, category, priority, subject, description, assigned_to?, sla_due_at?, status, resolution?, resolved_at?, closed_at? |
| `ticket_comments` | id, ticket_id, user_id, body, is_internal |
| `ticket_attachments` | id, ticket_id, file_url, file_name, mime, size |
| `ticket_history` | id, ticket_id, actor_id, action, old_value, new_value, created_at (immutable) |

### Maintenance 🆕
| Table | Key columns |
|---|---|
| `assets` | id, org_id, asset_no, category_id, serial_no, branch_id, location, assigned_to?, purchase_date, purchase_price, warranty_until, status |
| `asset_categories` | id, org_id, name |
| `maintenance_orders` | id, org_id, number, asset_id?, branch_id, space_id?, problem, priority, assigned_to?, estimated_cost, actual_cost, vendor_id?, status, completed_at |

### Finance ✅ (live, extend)
| Table | Key columns | Status |
|---|---|---|
| `invoices` | id, org_id, number, member_id/company_id, membership_id?, billing_address, subtotal, discount, tax, total, due_date, status, pdf_url 🆕 | ✅ + pdf |
| `invoice_items` | id, invoice_id, description, qty, unit_price, amount | ✅ |
| `payments` | id, org_id, invoice_id?, member_id, amount, date, method, reference, notes | ✅ |
| `credit_notes` | id, org_id, invoice_id, amount, reason, status | 🆕 |
| `refunds` | id, org_id, payment_id, amount, reason, status | 🆕 |
| `expenses` | id, org_id, branch_id, category_id, vendor_id?, amount, tax, date, method, receipt_url 🆕, notes | ✅ + receipt |
| `expense_categories` | id, org_id, name | ✅ |
| `cash_accounts` | id, org_id, name, type (cash/bank), balance | 🆕 |
| `transactions` | id, org_id, account_id, kind, amount, ref_type, ref_id, date | 🆕 |

### Operations 🆕
| Table | Key columns |
|---|---|
| `visitors` | id, org_id, branch_id, name, phone, company, host_member_id, purpose, check_in, check_out?, id_verified, photo_url?, pass_code |
| `staff` | id, org_id, user_id?, name, photo, email, phone, department, branch_id, joining_date, employment_status |
| `inventory_items` | id, org_id, branch_id, sku, name, category, qty_on_hand, min_stock, unit |
| `inventory_transactions` | id, item_id, kind (in/out/transfer), qty, ref, created_by |
| `vendors` | id, org_id, name, contact, email, phone, address |
| `contracts` | id, org_id, number, party_type, party_id, start_date, end_date, value, renewal_date?, status, document_url |
| `documents` | id, org_id, owner_type, owner_id, file_url, file_name, mime, size, uploaded_by |

### Platform 🆕
| Table | Key columns |
|---|---|
| `notifications` | id, org_id, user_id?, type, title, body, data (json), read_at, channel | ✅ extend |
| `notification_templates` | id, org_id, event, channel, subject, body |
| `audit_logs` | id, org_id, actor_id, action, entity, entity_id, old_value, new_value, ip, device, created_at (append-only) |
| `saas_plans` | id, name, price, limits (json: max_branches, max_members...), features (json) — NO org_id |
| `saas_subscriptions` | id, org_id, plan_id, status, trial_ends_at, current_period_end |
| `feature_flags` | id, org_id?, key, enabled |
| `webhook_endpoints` | id, org_id, url, events[], secret |
| `integrations` | id, org_id, provider (whatsapp/sms/email/payment), config (json encrypted), enabled |

---

## 5. Relationships (key)

- `organizations` 1:N `branches`, `users`, `members`, `companies`, `spaces`, `invoices`… (har table)
- `branches` 1:N `floors` 1:N `spaces`
- `companies` 1:N `members`
- `members` 1:N `memberships` N:1 `membership_plans`
- `spaces` 1:N `bookings` N:1 `members`
- `invoices` 1:N `invoice_items`, 1:N `payments`, 1:1 `credit_notes`
- `tickets` 1:N `comments`, `attachments`, `history`
- `assets` 1:N `maintenance_orders`
- `users` N:M `roles` N:M `permissions`
- **SaaS tables ka koi `org_id` nahi** (platform level), `saas_subscriptions.org_id` → organizations

---

## 6. RBAC Permission Matrix

| Permission | Super Admin | Org Admin | Branch Mgr | Finance | Reception | Support | Maint. | HR | Member |
|---|---|---|---|---|---|---|---|---|---|
| **SaaS Admin** ||||||||||
| saas.manage | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Members** ||||||||||
| members.view | ✅ | ✅ | branch | ❌ | ✅ | ❌ | ❌ | ❌ | own |
| members.create/edit | ✅ | ✅ | branch | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| members.delete | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Bookings** ||||||||||
| bookings.view | ✅ | ✅ | branch | ❌ | ✅ | ❌ | ❌ | ❌ | own |
| bookings.create | ✅ | ✅ | branch | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| bookings.manage (all) | ✅ | ✅ | branch | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Tickets** ||||||||||
| tickets.view | ✅ | ✅ | branch | ❌ | ❌ | ✅ | ❌ | ❌ | own |
| tickets.create | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| tickets.assign | ✅ | ✅ | branch | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| tickets.close | ✅ | ✅ | branch | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Maintenance** ||||||||||
| maintenance.view | ✅ | ✅ | branch | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| maintenance.manage | ✅ | ✅ | branch | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Finance** ||||||||||
| finance.view | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | own |
| invoices.create/edit | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| payments.record | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| expenses.manage | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Operations** ||||||||||
| visitors.manage | ✅ | ✅ | branch | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| staff.manage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| inventory.manage | ✅ | ✅ | branch | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| assets.manage | ✅ | ✅ | branch | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| contracts.manage | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| reports.view | ✅ | ✅ | branch | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| audit.view | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| settings.manage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

`branch` = sirf assigned branches ka data. `own` = sirf apna record. Enforcement **backend middleware** me, har request par.

---

## 7. API Endpoint List

Base: `/api` — Auth: `Bearer JWT` — Pagination: `?page&limit&sort&search` — Errors: `{ error: { code, message, details } }`

```
# Auth ✅ (extend: 2fa, reset, verify, sessions)
POST /api/auth/login · POST /api/auth/refresh · POST /api/auth/logout
POST /api/auth/forgot-password 🆕 · POST /api/auth/reset-password 🆕
POST /api/auth/verify-email 🆕 · POST /api/auth/2fa/enable|verify 🆕
GET  /api/auth/sessions 🆕 · DELETE /api/auth/sessions/:id 🆕
GET  /api/auth/me ✅

# Organizations / Branches / Spaces
GET/POST /api/organizations 🆕 (super_admin) · GET/PUT /api/organizations/:id
GET/POST /api/branches ✅ · GET/PUT/DELETE /api/branches/:id ✅
GET/POST /api/floors 🆕 · GET/PUT/DELETE /api/floors/:id 🆕
GET/POST /api/spaces ✅ · GET/PUT/DELETE /api/spaces/:id ✅
GET /api/spaces/availability?from&to&type 🆕 (double-booking check)

# Members / Companies / Memberships
GET/POST /api/members ✅ · GET/PUT/DELETE /api/members/:id ✅
GET /api/members/:id/timeline 🆕 (activity)
GET/POST /api/companies ✅ · GET/PUT/DELETE /api/companies/:id ✅
GET/POST /api/membership-plans 🆕 · GET/PUT/DELETE /api/membership-plans/:id 🆕
GET/POST /api/memberships ✅ · GET/PUT/DELETE /api/memberships/:id ✅

# Bookings
GET/POST /api/bookings ✅ · GET/PUT/DELETE /api/bookings/:id ✅
POST /api/bookings/:id/check-in 🆕 · POST /api/bookings/:id/cancel 🆕
GET /api/bookings/calendar?view=day|week|month 🆕

# Tickets 🆕 (poora naya)
GET/POST /api/tickets · GET/PUT /api/tickets/:id
POST /api/tickets/:id/assign · POST /api/tickets/:id/comments
POST /api/tickets/:id/resolve · POST /api/tickets/:id/close
GET /api/tickets/:id/history

# Maintenance 🆕
GET/POST /api/assets · GET/PUT/DELETE /api/assets/:id
GET/POST /api/maintenance-orders · GET/PUT /api/maintenance-orders/:id
POST /api/maintenance-orders/:id/complete

# Finance
GET/POST /api/invoices ✅ · GET/PUT /api/invoices/:id ✅
POST /api/invoices/:id/issue 🆕 · GET /api/invoices/:id/pdf 🆕
GET/POST /api/payments ✅ · GET/POST /api/expenses ✅
GET/POST /api/credit-notes 🆕 · GET/POST /api/refunds 🆕
GET /api/finance/summary?from&to&branch 🆕

# Operations 🆕
GET/POST /api/visitors · POST /api/visitors/:id/check-out
GET/POST /api/staff · GET/PUT /api/staff/:id
GET/POST /api/inventory · POST /api/inventory/:id/transactions
GET/POST /api/contracts · GET/PUT /api/contracts/:id
GET/POST /api/documents (S3 presigned upload 🆕) · GET /api/documents/:id/download

# Platform
GET /api/notifications ✅ · POST /api/notifications/read ✅
GET /api/reports/:type?from&to&branch&format=csv|xlsx|pdf 🆕
GET /api/audit-logs 🆕 (immutable, admin only)
GET /api/search?q= 🆕 (members, companies, invoices, tickets, bookings...)

# SaaS Admin 🆕 (super_admin only, platform scope)
GET/POST /api/saas/plans · GET/POST /api/saas/subscriptions
GET /api/saas/organizations · POST /api/saas/feature-flags
GET /api/saas/analytics
```

---

## 8. Frontend Route List

```
# Public
/ /login ✅ · /forgot-password 🆕 · /reset-password/:token 🆕
/verify-email/:token 🆕

# Admin/Staff (app layout + sidebar)
/dashboard ✅ (charts ✅ + date ranges 🆕)
/members ✅ · /members/:id 🆕 (profile + timeline)
/companies ✅ · /memberships ✅ · /membership-plans 🆕
/spaces ✅ · /spaces/floor-plan 🆕
/bookings ✅ · /bookings/calendar 🆕
/tickets 🆕 · /tickets/:id 🆕
/maintenance 🆕 · /assets 🆕 · /inventory 🆕
/visitors 🆕 · /staff ✅(extend) · /attendance ✅
/finance 🆕 · /invoices ✅ · /payments ✅ · /expenses ✅
/contracts 🆕 · /documents 🆕
/reports ✅(extend: exports 🆕) · /audit-logs 🆕
/settings ✅ (org profile, branding, invoice settings 🆕)
/saas-admin 🆕 (super_admin only)

# Member Portal (alag layout, limited nav)
/m/dashboard 🆕 · /m/bookings 🆕 · /m/invoices 🆕
/m/tickets 🆕 · /m/documents 🆕 · /m/profile 🆕
```

---

## 9. Admin Navigation (sidebar)

```
Overview (dashboard)
Workspaces → Discover Booking · Booking History · Floor Plan 🆕 · Ride Sharing
Members → All Members · Companies · Membership Plans 🆕 · Memberships
Bookings → Calendar 🆕 · All Bookings
Support → Tickets 🆕 · (badge: open count)
Operations → Maintenance 🆕 · Assets 🆕 · Inventory 🆕 · Visitors 🆕 · Staff · Attendance
Finance → Overview 🆕 · Invoices · Payments · Expenses · Credit Notes 🆕
Contracts & Docs → Contracts 🆕 · Documents 🆕
Reports → All Reports · Audit Logs 🆕
Settings
SaaS Admin 🆕 (super_admin only) → Organizations · Plans · Subscriptions · Analytics
```

---

## 10. Member Navigation (portal)

```
My Dashboard · My Bookings · My Invoices · My Tickets ·
My Documents · My Profile
```
(Koi admin route accessible nahi — backend RBAC enforce karega.)

---

## 11. MVP Roadmap (Section 43 ke mutabiq, live se map)

| # | MVP Item | Status |
|---|---|---|
| 1 | Authentication | ✅ live (+ 2FA/reset/verify 🆕) |
| 2 | Multi-tenancy | ✅ live |
| 3 | Organization | ✅ live (+ settings/branding 🆕) |
| 4 | Branches | ✅ live (+ floors 🆕) |
| 5 | Members | ✅ live (+ timeline 🆕) |
| 6 | Companies | ✅ live |
| 7 | Membership plans | 🆕 (contracts se separate) |
| 8 | Desks/offices/rooms | ✅ live (+ floor plan 🆕) |
| 9 | Booking | ✅ live (+ calendar, double-booking guard 🆕) |
| 10 | Complaints/tickets | 🆕 **(sab se bara naya module)** |
| 11 | Invoices | ✅ live (+ PDF 🆕) |
| 12 | Payments | ✅ live |
| 13 | Expenses | ✅ live |
| 14 | Dashboard | ✅ live (+ date ranges, more charts 🆕) |
| 15 | Member portal | 🆕 (alag layout) |
| 16 | RBAC | ✅ live (+ granular permissions 🆕) |
| 17 | Audit logs | 🆕 |

**Phases:** P1 Foundation (auth+, tenant, RBAC granular, audit) → P2 Core (plans, floors, floor-plan, booking calendar) → P3 Operations (tickets, maintenance, visitors, staff) → P4 Finance+ (PDF, credit notes, accounts) → P5 Assets/Inventory/Docs/Contracts → P6 Reports/exports/search → P7 SaaS admin → P8 Integrations → P9 AI (optional).

---

## 12. Phase 1 Implementation Plan

**Goal:** Foundation mazboot — security, tenant isolation proof, audit, granular RBAC.

| Step | Kaam | Test |
|---|---|---|
| 1.1 | `permissions` + `role_permissions` tables, seed matrix (Section 6) | Unit: har role ka permission set |
| 1.2 | RBAC middleware: `requirePermission('tickets.create')` — role-name checks hatao | API test: har endpoint par 403 cases |
| 1.3 | Tenant isolation test suite: Org A ka token → Org B ka data **kabhi nahi** | Automated: har module par cross-tenant test |
| 1.4 | `audit_logs` — middleware se auto-log (create/update/delete) | Verify: action → log entry, immutable |
| 1.5 | Auth+: password reset (email), email verify, 2FA (TOTP), sessions list/revoke | E2E: reset flow, 2FA login |
| 1.6 | Rate limiting + input validation (zod) global | Abuse test |
| 1.7 | `packages/permissions` shared constants | — |
| 1.8 | Deploy + full regression (koi live feature na toote) | Live check |

**Phase 1 me koi naya business module nahi** — sirf foundation. (Section 42/48 ke mutabiq.)

---

## 13. Deployment Architecture

```
Current (live) ✅:
  Cloudflare Pages (frontend static)
  → VPS Docker single-container (API + PostgreSQL)
  → Nginx Proxy Manager (HTTPS, Let's Encrypt)

Target (Phase 6+):
  Cloudflare Pages (frontend)
  → VPS: docker-compose
      ├── nginx (reverse proxy, rate limit)
      ├── api (Node, 2 replicas optional)
      ├── postgres (volume + nightly backup to S3)
      ├── redis (cache + BullMQ queues)
  → S3-compatible storage (documents, invoice PDFs, receipts)
  → Uptime/health: /api/health ✅ (already) + queue dashboard
```

`.env.example` me: `DATABASE_URL, JWT_SECRET, REDIS_URL, S3_*, EMAIL_*, SMS_*, APP_URL` — **koi secret hard-code nahi**.

---

## 14. Security Architecture

| Area | Implementation |
|---|---|
| Tenant isolation | `tenant.js` middleware → `req.tenantId`; Prisma queries me mandatory; **cross-tenant automated tests** (Section 45 critical test) |
| RBAC | Granular permissions (Section 6); backend enforce; frontend sirf UX |
| Auth | bcrypt (12 rounds), JWT access (15m) + refresh (rotating), 2FA TOTP, session/device list |
| Input | zod validation har endpoint par; SQL injection: Prisma parameterized (raw query ban) |
| XSS/CSRF | React escaping; CSRF tokens mutations par; `HttpOnly; Secure; SameSite` cookies |
| Rate limiting | Login 5/min, API 100/min per IP+user (Redis) |
| Files | S3 presigned URLs, mime whitelist, size limits, download auth check |
| Secrets | Sirf env vars; `.env` kabhi repo me nahi |
| Audit | Append-only `audit_logs`; normal users immutable |
| Payments | Card numbers **kabhi store nahi** — sirf reference/method |
| HTTPS | TLS everywhere; HSTS |

---

## ✅ Approval Checklist

- [ ] Architecture (Section 1) approved
- [ ] Stack decision (evolve, no rewrite) approved
- [ ] Database schema (Sections 3–5) approved
- [ ] RBAC matrix (Section 6) approved
- [ ] API + routes (Sections 7–10) approved
- [ ] MVP roadmap + Phase 1 plan (Sections 11–12) approved
- [ ] Deployment + Security (Sections 13–14) approved

**Approve karein to Phase 1 start hogi.** Koi code Phase 1 se pehle nahi likha jayega (Section 49).
