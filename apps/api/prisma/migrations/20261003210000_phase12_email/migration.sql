-- Phase 12: Email settings per tenant

CREATE TABLE "email_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 587,
    "secure" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT,
    "password" TEXT,
    "from_name" TEXT,
    "from_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_settings_tenant_id_key" ON "email_settings"("tenant_id");
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
