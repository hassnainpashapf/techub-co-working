-- CreateTable
CREATE TABLE "buildings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "floors" ADD COLUMN "building_id" TEXT;

-- CreateIndex
CREATE INDEX "buildings_tenant_id_idx" ON "buildings"("tenant_id");

-- CreateIndex
CREATE INDEX "floors_tenant_id_building_id_idx" ON "floors"("tenant_id", "building_id");

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floors" ADD CONSTRAINT "floors_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
