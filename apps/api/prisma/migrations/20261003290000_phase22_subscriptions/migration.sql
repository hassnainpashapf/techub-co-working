-- Phase 22: SaaS subscriptions & platform plans

CREATE TABLE "platform_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "price_monthly" DOUBLE PRECISION NOT NULL,
    "max_users" INTEGER NOT NULL,
    "max_members" INTEGER NOT NULL,
    "max_units" INTEGER NOT NULL,
    "features" TEXT[] NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_plans_slug_key" ON "platform_plans"("slug");

CREATE TABLE "tenant_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_subscriptions_tenant_id_key" ON "tenant_subscriptions"("tenant_id");
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "platform_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
