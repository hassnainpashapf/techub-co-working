-- Phase 56: Storage & Locker Management Pack

CREATE TABLE "lockers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "location" TEXT,
  "size" TEXT NOT NULL DEFAULT 'M',
  "status" TEXT NOT NULL DEFAULT 'available',
  "monthly_rate" DECIMAL(14,2),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lockers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "lockers_tenant_id_code_key" ON "lockers"("tenant_id", "code");
CREATE INDEX "lockers_tenant_id_status_idx" ON "lockers"("tenant_id", "status");
CREATE INDEX "lockers_tenant_id_size_idx" ON "lockers"("tenant_id", "size");

CREATE TABLE "locker_rentals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "locker_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "end_date" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'active',
  "monthly_rate" DECIMAL(12,2) NOT NULL,
  "auto_renew" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "locker_rentals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "locker_rentals_locker_id_fkey" FOREIGN KEY ("locker_id") REFERENCES "lockers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "locker_rentals_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "locker_rentals_tenant_id_status_idx" ON "locker_rentals"("tenant_id", "status");
CREATE INDEX "locker_rentals_tenant_id_locker_id_idx" ON "locker_rentals"("tenant_id", "locker_id");
CREATE INDEX "locker_rentals_tenant_id_member_id_idx" ON "locker_rentals"("tenant_id", "member_id");

CREATE TABLE "locker_codes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "locker_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "issued_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "locker_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "locker_codes_locker_id_fkey" FOREIGN KEY ("locker_id") REFERENCES "lockers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "locker_codes_locker_id_key" ON "locker_codes"("locker_id");
CREATE INDEX "locker_codes_tenant_id_idx" ON "locker_codes"("tenant_id");

CREATE TABLE "locker_waitlist" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "size" TEXT NOT NULL DEFAULT 'M',
  "status" TEXT NOT NULL DEFAULT 'waiting',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "locker_waitlist_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "locker_waitlist_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "locker_waitlist_tenant_id_status_idx" ON "locker_waitlist"("tenant_id", "status");
CREATE INDEX "locker_waitlist_tenant_id_member_id_idx" ON "locker_waitlist"("tenant_id", "member_id");

CREATE TABLE "locker_maintenance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "locker_id" TEXT NOT NULL,
  "issue" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "reported_by" TEXT,
  "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fixed_at" TIMESTAMP(3),
  CONSTRAINT "locker_maintenance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "locker_maintenance_locker_id_fkey" FOREIGN KEY ("locker_id") REFERENCES "lockers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "locker_maintenance_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "locker_maintenance_tenant_id_status_idx" ON "locker_maintenance"("tenant_id", "status");
CREATE INDEX "locker_maintenance_tenant_id_locker_id_idx" ON "locker_maintenance"("tenant_id", "locker_id");
