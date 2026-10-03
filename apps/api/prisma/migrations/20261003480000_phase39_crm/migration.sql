-- Phase 39: Sales CRM Pack

-- Lead delta columns
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "score" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_contact_at" TIMESTAMPTZ(6);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_reason" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lost_at" TIMESTAMPTZ(6);

-- lead_activities
CREATE TABLE IF NOT EXISTS "lead_activities" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lead_activities_tenant_id_lead_id_created_at_idx" ON "lead_activities"("tenant_id", "lead_id", "created_at");
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- tours
CREATE TABLE IF NOT EXISTS "tours" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
  "duration_min" INTEGER NOT NULL DEFAULT 30,
  "assigned_to" TEXT,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "notes" TEXT,
  "outcome" TEXT,
  "reminder_24h_sent_at" TIMESTAMPTZ(6),
  "reminder_2h_sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tours_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tours_tenant_id_scheduled_at_idx" ON "tours"("tenant_id", "scheduled_at");
CREATE INDEX IF NOT EXISTS "tours_lead_id_idx" ON "tours"("lead_id");
ALTER TABLE "tours" ADD CONSTRAINT "tours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "tours" ADD CONSTRAINT "tours_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "tours" ADD CONSTRAINT "tours_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- quotations
CREATE TABLE IF NOT EXISTS "quotations" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "valid_till" TIMESTAMPTZ(6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sent_at" TIMESTAMPTZ(6),
  "created_by" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_tenant_id_number_key" ON "quotations"("tenant_id", "number");
CREATE INDEX IF NOT EXISTS "quotations_tenant_id_lead_id_idx" ON "quotations"("tenant_id", "lead_id");
CREATE INDEX IF NOT EXISTS "quotations_tenant_id_status_idx" ON "quotations"("tenant_id", "status");
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- lead_followups
CREATE TABLE IF NOT EXISTS "lead_followups" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "due_at" TIMESTAMPTZ(6) NOT NULL,
  "type" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "assigned_to" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "lead_followups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "lead_followups_tenant_id_status_due_at_idx" ON "lead_followups"("tenant_id", "status", "due_at");
CREATE INDEX IF NOT EXISTS "lead_followups_tenant_id_assigned_to_status_idx" ON "lead_followups"("tenant_id", "assigned_to", "status");
CREATE INDEX IF NOT EXISTS "lead_followups_lead_id_idx" ON "lead_followups"("lead_id");
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
