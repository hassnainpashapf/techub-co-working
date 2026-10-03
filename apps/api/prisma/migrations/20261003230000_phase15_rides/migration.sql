-- Phase 15: Ride sharing (database-backed)

CREATE TABLE "rides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "driver_user_id" TEXT,
    "driver_name" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "seats_total" INTEGER NOT NULL,
    "seats_left" INTEGER NOT NULL,
    "car" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rides_tenant_id_status_date_idx" ON "rides"("tenant_id", "status", "date");
ALTER TABLE "rides" ADD CONSTRAINT "rides_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_user_id_fkey"
  FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ride_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "requester_user_id" TEXT,
    "requester_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ride_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ride_requests_ride_id_requester_user_id_key" ON "ride_requests"("ride_id", "requester_user_id");
CREATE INDEX "ride_requests_tenant_id_ride_id_idx" ON "ride_requests"("tenant_id", "ride_id");
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_ride_id_fkey"
  FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_requester_user_id_fkey"
  FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
