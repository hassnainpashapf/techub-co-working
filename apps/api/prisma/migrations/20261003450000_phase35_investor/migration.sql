-- Phase 35: Investor & Analytics Pack

-- Tenant suspension fields
ALTER TABLE "tenants" ADD COLUMN "suspended_at" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "suspended_reason" TEXT;

-- KPI dashboards
CREATE TABLE "kpi_dashboards" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kpi_dashboards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "kpi_dashboards_tenant_id_user_id_idx" ON "kpi_dashboards"("tenant_id", "user_id");
ALTER TABLE "kpi_dashboards" ADD CONSTRAINT "kpi_dashboards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kpi_dashboards" ADD CONSTRAINT "kpi_dashboards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
