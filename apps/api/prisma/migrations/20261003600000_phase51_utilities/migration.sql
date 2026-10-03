-- Phase 51: Utility & Sustainability Pack

CREATE TABLE "utility_meters" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'electricity',
  "unit_id" TEXT REFERENCES "units"("id") ON DELETE SET NULL,
  "building_id" TEXT REFERENCES "buildings"("id") ON DELETE SET NULL,
  "meter_number" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "utility_meters_tenant_id_is_active_idx" ON "utility_meters"("tenant_id", "is_active");
CREATE INDEX "utility_meters_tenant_id_type_idx" ON "utility_meters"("tenant_id", "type");

CREATE TABLE "meter_readings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "meterId" TEXT NOT NULL REFERENCES "utility_meters"("id") ON DELETE CASCADE,
  "reading" DECIMAL(12,2) NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readById" TEXT,
  "photoUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meter_readings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);
CREATE INDEX "meter_readings_meterId_readAt_idx" ON "meter_readings"("meterId", "readAt" DESC);
CREATE INDEX "meter_readings_tenantId_idx" ON "meter_readings"("tenantId");

CREATE TABLE "utility_rates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "rate_per_unit" DECIMAL(12,4) NOT NULL,
  "fixed_charge" DECIMAL(12,2),
  "effective_from" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "utility_rates_tenant_id_type_effective_from_idx" ON "utility_rates"("tenant_id", "type", "effective_from");

CREATE TABLE "utility_bills" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "member_id" TEXT REFERENCES "members"("id") ON DELETE SET NULL,
  "unit_id" TEXT,
  "meter_id" TEXT NOT NULL REFERENCES "utility_meters"("id") ON DELETE RESTRICT,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "consumption" DECIMAL(12,2) NOT NULL,
  "rate_per_unit" DECIMAL(12,4) NOT NULL,
  "fixed_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(12,2) NOT NULL,
  "invoice_id" TEXT REFERENCES "invoices"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "utility_bills_tenant_id_meter_id_period_start_key" UNIQUE ("tenant_id", "meter_id", "period_start")
);
CREATE INDEX "utility_bills_tenant_id_member_id_idx" ON "utility_bills"("tenant_id", "member_id");
CREATE INDEX "utility_bills_tenant_id_status_idx" ON "utility_bills"("tenant_id", "status");

CREATE TABLE "green_initiatives" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'energy',
  "target_value" DOUBLE PRECISION,
  "current_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unit" TEXT,
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'planned',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "green_initiatives_tenant_id_status_idx" ON "green_initiatives"("tenant_id", "status");
CREATE INDEX "green_initiatives_tenant_id_category_idx" ON "green_initiatives"("tenant_id", "category");
