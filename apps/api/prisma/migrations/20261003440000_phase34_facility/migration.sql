-- Phase 34: Facility Operations Pack

-- Shifts
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL, "start_time" TEXT NOT NULL, "end_time" TEXT NOT NULL,
    "role" TEXT, "notes" TEXT, "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shifts_user_id_date_key" ON "shifts"("user_id", "date");
CREATE INDEX "shifts_tenant_id_date_idx" ON "shifts"("tenant_id", "date");
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL, "start_time" TEXT NOT NULL, "end_time" TEXT NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shift_templates_tenant_id_user_id_day_of_week_key" ON "shift_templates"("tenant_id", "user_id", "day_of_week");
CREATE INDEX "shift_templates_tenant_id_idx" ON "shift_templates"("tenant_id");
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Facility assets (checkout-based; `assets` table is the older inventory one)
CREATE TABLE "facility_assets" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "name" TEXT NOT NULL,
    "category" TEXT NOT NULL, "serial_number" TEXT, "purchase_date" TIMESTAMP(3),
    "value" DECIMAL(12,2), "status" TEXT NOT NULL DEFAULT 'available', "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "facility_assets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "facility_assets_tenant_id_status_idx" ON "facility_assets"("tenant_id", "status");
CREATE INDEX "facility_assets_tenant_id_category_idx" ON "facility_assets"("tenant_id", "category");
ALTER TABLE "facility_assets" ADD CONSTRAINT "facility_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "facility_asset_checkouts" (
    "id" TEXT NOT NULL, "asset_id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL,
    "member_id" TEXT, "user_id" TEXT,
    "checked_out_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3), "returned_at" TIMESTAMP(3), "condition" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "facility_asset_checkouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "facility_asset_checkouts_tenant_id_returned_at_idx" ON "facility_asset_checkouts"("tenant_id", "returned_at");
CREATE INDEX "facility_asset_checkouts_asset_id_returned_at_idx" ON "facility_asset_checkouts"("asset_id", "returned_at");
ALTER TABLE "facility_asset_checkouts" ADD CONSTRAINT "facility_asset_checkouts_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "facility_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "facility_asset_checkouts" ADD CONSTRAINT "facility_asset_checkouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "facility_asset_checkouts" ADD CONSTRAINT "facility_asset_checkouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "facility_asset_checkouts" ADD CONSTRAINT "facility_asset_checkouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Maintenance requests (member-facing; `maintenance_orders` is the staff work-order one)
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT, "location" TEXT,
    "unit_id" TEXT, "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "member_id" TEXT, "reported_by_id" TEXT NOT NULL, "assigned_to_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "maintenance_requests_tenant_id_status_idx" ON "maintenance_requests"("tenant_id", "status");
CREATE INDEX "maintenance_requests_tenant_id_priority_idx" ON "maintenance_requests"("tenant_id", "priority");
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Parking
CREATE TABLE "parking_spots" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'car', "status" TEXT NOT NULL DEFAULT 'free',
    "notes" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parking_spots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parking_spots_tenant_id_label_key" ON "parking_spots"("tenant_id", "label");
CREATE INDEX "parking_spots_tenant_id_status_idx" ON "parking_spots"("tenant_id", "status");
ALTER TABLE "parking_spots" ADD CONSTRAINT "parking_spots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "parking_assignments" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "spot_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL, "vehicle_number" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "parking_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "parking_assignments_tenant_id_status_idx" ON "parking_assignments"("tenant_id", "status");
CREATE INDEX "parking_assignments_spot_id_status_idx" ON "parking_assignments"("spot_id", "status");
ALTER TABLE "parking_assignments" ADD CONSTRAINT "parking_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parking_assignments" ADD CONSTRAINT "parking_assignments_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "parking_spots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parking_assignments" ADD CONSTRAINT "parking_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mail & parcels
CREATE TABLE "mail_items" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'package', "sender" TEXT, "tracking_number" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3), "collected_at" TIMESTAMP(3), "collected_by" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'received', "notes" TEXT,
    CONSTRAINT "mail_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mail_items_tenant_id_status_idx" ON "mail_items"("tenant_id", "status");
CREATE INDEX "mail_items_member_id_idx" ON "mail_items"("member_id");
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Printing credits
CREATE TABLE "print_credits" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
    "month" TEXT NOT NULL, "included_pages" INTEGER NOT NULL,
    "used_pages" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "print_credits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "print_credits_member_id_month_key" ON "print_credits"("member_id", "month");
CREATE INDEX "print_credits_tenant_id_month_idx" ON "print_credits"("tenant_id", "month");
ALTER TABLE "print_credits" ADD CONSTRAINT "print_credits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_credits" ADD CONSTRAINT "print_credits_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "print_jobs" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
    "pages" INTEGER NOT NULL, "cost" DECIMAL(12,2), "logged_by" TEXT, "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "print_jobs_tenant_id_member_id_idx" ON "print_jobs"("tenant_id", "member_id");
CREATE INDEX "print_jobs_tenant_id_created_at_idx" ON "print_jobs"("tenant_id", "created_at");
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WiFi vouchers
CREATE TABLE "wifi_vouchers" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "code" TEXT NOT NULL,
    "member_id" TEXT, "duration_hours" INTEGER NOT NULL, "max_devices" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'active', "expires_at" TIMESTAMP(3), "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wifi_vouchers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wifi_vouchers_code_key" ON "wifi_vouchers"("code");
CREATE INDEX "wifi_vouchers_tenant_id_status_idx" ON "wifi_vouchers"("tenant_id", "status");
CREATE INDEX "wifi_vouchers_member_id_idx" ON "wifi_vouchers"("member_id");
ALTER TABLE "wifi_vouchers" ADD CONSTRAINT "wifi_vouchers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wifi_vouchers" ADD CONSTRAINT "wifi_vouchers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lost & found
CREATE TABLE "lost_found_items" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "type" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT, "location" TEXT, "image_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open', "member_id" TEXT,
    "reported_by" TEXT, "claimed_by" TEXT, "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lost_found_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lost_found_items_tenant_id_status_idx" ON "lost_found_items"("tenant_id", "status");
CREATE INDEX "lost_found_items_tenant_id_type_status_idx" ON "lost_found_items"("tenant_id", "type", "status");
ALTER TABLE "lost_found_items" ADD CONSTRAINT "lost_found_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lost_found_items" ADD CONSTRAINT "lost_found_items_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Housekeeping
CREATE TABLE "cleaning_tasks" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "title" TEXT NOT NULL,
    "description" TEXT, "area" TEXT, "unit_id" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'one-time',
    "assigned_to_id" TEXT, "due_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending', "notes" TEXT,
    "completed_at" TIMESTAMP(3), "completed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cleaning_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cleaning_tasks_tenant_id_status_idx" ON "cleaning_tasks"("tenant_id", "status");
CREATE INDEX "cleaning_tasks_tenant_id_due_date_idx" ON "cleaning_tasks"("tenant_id", "due_date");
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cleaning_tasks" ADD CONSTRAINT "cleaning_tasks_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
