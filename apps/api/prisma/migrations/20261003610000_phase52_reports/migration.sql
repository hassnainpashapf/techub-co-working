-- Phase 52: Custom Report Builder Pack
CREATE TABLE "custom_reports" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "columns" JSONB NOT NULL,
  "filters" JSONB,
  "sorts" JSONB,
  "group_by" TEXT,
  "is_public" BOOLEAN NOT NULL DEFAULT false,
  "owner_id" TEXT,
  "shared_with_roles" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "custom_reports_tenant_id_entity_idx" ON "custom_reports"("tenant_id", "entity");
ALTER TABLE "custom_reports" ADD CONSTRAINT "custom_reports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "report_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_schedules_tenant_id_idx" ON "report_schedules"("tenant_id");
CREATE INDEX "report_schedules_is_active_last_sent_at_idx" ON "report_schedules"("is_active", "last_sent_at");
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "custom_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "report_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "name" TEXT,
    "metric_field" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL DEFAULT 'sum',
    "operator" TEXT NOT NULL,
    "threshold" DECIMAL(14,2) NOT NULL,
    "check_frequency" TEXT NOT NULL DEFAULT 'daily',
    "last_run_at" TIMESTAMP(3),
    "last_triggered_at" TIMESTAMP(3),
    "last_value" DECIMAL(14,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "report_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_alerts_tenant_id_is_active_idx" ON "report_alerts"("tenant_id", "is_active");
CREATE INDEX "report_alerts_report_id_idx" ON "report_alerts"("report_id");
ALTER TABLE "report_alerts" ADD CONSTRAINT "report_alerts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_alerts" ADD CONSTRAINT "report_alerts_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "custom_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
