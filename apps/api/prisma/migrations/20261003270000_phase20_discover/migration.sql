-- Phase 20: Discover genuine filters (amenities + favorites)

-- Add new unit types (PostgreSQL 12+ allows this in a transaction)
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'virtual_office';
ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS 'accommodation';

ALTER TABLE "units" ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE "unit_favorites" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "unit_favorites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "unit_favorites_tenant_id_unit_id_user_id_key" ON "unit_favorites"("tenant_id", "unit_id", "user_id");
CREATE INDEX "unit_favorites_tenant_id_user_id_idx" ON "unit_favorites"("tenant_id", "user_id");
ALTER TABLE "unit_favorites" ADD CONSTRAINT "unit_favorites_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "unit_favorites" ADD CONSTRAINT "unit_favorites_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "unit_favorites" ADD CONSTRAINT "unit_favorites_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed amenities for existing units based on type
UPDATE "units" SET "amenities" = ARRAY['Wi-fi','AC','Coffee','Parking'] WHERE "type" IN ('hot_desk','dedicated_desk','cabin');
UPDATE "units" SET "amenities" = ARRAY['Wi-fi','AC','Coffee'] WHERE "type" IN ('meeting_room','phone_booth');
UPDATE "units" SET "amenities" = ARRAY['Wi-fi','Parking'] WHERE "type" IN ('virtual_office','accommodation');
