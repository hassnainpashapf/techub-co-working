-- Phase 2: membership plans + floor-plan coordinates on units

-- MembershipPlan
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "unit_type" "UnitType",
    "features" TEXT[] NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "membership_plans_tenant_id_is_active_idx" ON "membership_plans"("tenant_id", "is_active");
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contract.planId (optional link to a membership plan)
ALTER TABLE "contracts" ADD COLUMN "plan_id" TEXT;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Unit floor-plan grid coordinates
ALTER TABLE "units" ADD COLUMN "pos_x" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "units" ADD COLUMN "pos_y" INTEGER NOT NULL DEFAULT 0;
