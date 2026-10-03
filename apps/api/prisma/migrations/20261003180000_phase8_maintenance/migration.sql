-- Phase 8: Maintenance work orders

CREATE TYPE "MaintenanceStatus" AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

CREATE TABLE "maintenance_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'pending',
    "unit_id" TEXT,
    "assigned_to_id" TEXT,
    "ticket_id" TEXT,
    "cost" DECIMAL(12,2),
    "scheduled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "maintenance_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "maintenance_orders_tenant_id_order_number_key" ON "maintenance_orders"("tenant_id", "order_number");
CREATE INDEX "maintenance_orders_tenant_id_status_idx" ON "maintenance_orders"("tenant_id", "status");
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_assigned_to_id_fkey"
  FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
