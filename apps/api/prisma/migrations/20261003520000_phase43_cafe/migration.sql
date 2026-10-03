-- Phase 43: Cafeteria & F&B Pack (20261003520000_phase43_cafe)

CREATE TABLE "menu_categories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "menu_categories_tenant_id_sort_order_idx" ON "menu_categories"("tenant_id", "sort_order");
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "menu_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "image_url" TEXT,
  "is_available" BOOLEAN NOT NULL DEFAULT true,
  "tags" JSONB NOT NULL DEFAULT '[]',
  "prep_time_min" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "menu_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "menu_items_tenant_id_category_id_idx" ON "menu_items"("tenant_id", "category_id");
CREATE INDEX "menu_items_tenant_id_is_available_idx" ON "menu_items"("tenant_id", "is_available");

CREATE TABLE "food_orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "delivery_zone" TEXT,
  "note" TEXT,
  "ordered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ready_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
  "payment_method" TEXT,
  "paid_at" TIMESTAMPTZ,
  "invoice_id" TEXT,
  CONSTRAINT "food_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "food_orders_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "food_orders_tenant_id_member_id_idx" ON "food_orders"("tenant_id", "member_id");
CREATE INDEX "food_orders_tenant_id_status_idx" ON "food_orders"("tenant_id", "status");
CREATE INDEX "food_orders_tenant_id_payment_status_idx" ON "food_orders" ("tenant_id", "payment_status");

CREATE TABLE "delivery_zones" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_zones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "delivery_zones_tenant_id_sort_order_idx" ON "delivery_zones"("tenant_id", "sort_order");
CREATE INDEX "delivery_zones_tenant_id_is_active_idx" ON "delivery_zones"("tenant_id", "is_active");

CREATE TABLE "meal_plans" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "meals_per_day" INTEGER NOT NULL DEFAULT 1,
  "valid_days" INTEGER NOT NULL DEFAULT 30,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meal_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "meal_plans_tenant_id_is_active_idx" ON "meal_plans"("tenant_id", "is_active");

CREATE TABLE "member_meal_plans" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date" TIMESTAMP(3) NOT NULL,
  "meals_used" INTEGER NOT NULL DEFAULT 0,
  "meals_total" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "member_meal_plans_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_meal_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_meal_plans_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "member_meal_plans_tenant_id_member_id_idx" ON "member_meal_plans"("tenant_id", "member_id");
CREATE INDEX "member_meal_plans_tenant_id_status_idx" ON "member_meal_plans"("tenant_id", "status");

CREATE TABLE "food_ratings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "menu_item_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "score" INTEGER NOT NULL CHECK ("score" BETWEEN 1 AND 5),
  "comment" TEXT,
  "rated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "food_ratings_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "food_ratings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "food_ratings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "food_ratings_menu_item_id_member_id_key" ON "food_ratings"("menu_item_id", "member_id");
CREATE INDEX "food_ratings_tenant_id_menu_item_id_idx" ON "food_ratings"("tenant_id", "menu_item_id");
CREATE INDEX "food_ratings_tenant_id_member_id_idx" ON "food_ratings"("tenant_id", "member_id");

CREATE TABLE "cafe_staff" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "employee_id" TEXT NOT NULL UNIQUE REFERENCES "employees"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX "cafe_staff_tenant_active_idx" ON "cafe_staff"("tenant_id", "is_active");
CREATE INDEX "cafe_staff_tenant_role_idx" ON "cafe_staff"("tenant_id", "role");

CREATE TABLE "food_waste" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "menu_item_id" TEXT,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'spoiled',
  "cost_estimate" DECIMAL(12,2),
  "recorded_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "food_waste_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "food_waste_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "food_waste_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "food_waste_tenant_id_date_idx" ON "food_waste"("tenant_id", "date");
CREATE INDEX "food_waste_tenant_id_reason_idx" ON "food_waste"("tenant_id", "reason");
