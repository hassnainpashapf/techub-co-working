-- Phase 29: Growth & Operations Pack

CREATE TABLE "recurring_bookings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT,
    "unit_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "generated_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recurring_bookings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recurring_bookings_tenant_id_idx" ON "recurring_bookings"("tenant_id");
CREATE INDEX "recurring_bookings_tenant_id_status_idx" ON "recurring_bookings"("tenant_id", "status");
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_bookings" ADD CONSTRAINT "recurring_bookings_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "source" TEXT NOT NULL DEFAULT 'walkin',
    "interest" TEXT,
    "budget" DECIMAL(12,2),
    "stage" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "assigned_to" TEXT,
    "converted_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leads_tenant_id_stage_idx" ON "leads"("tenant_id", "stage");
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_fkey"
  FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_member_id_fkey"
  FOREIGN KEY ("converted_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "rating" INTEGER NOT NULL DEFAULT 5,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "admin_reply" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feedback_tenant_id_status_idx" ON "feedback"("tenant_id", "status");
CREATE INDEX "feedback_member_id_idx" ON "feedback"("member_id");
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expense approval workflow columns
ALTER TABLE "expenses" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "expenses" ADD COLUMN "reviewed_by" TEXT;
ALTER TABLE "expenses" ADD COLUMN "reviewed_at" TIMESTAMP(3);
ALTER TABLE "expenses" ADD COLUMN "review_note" TEXT;
