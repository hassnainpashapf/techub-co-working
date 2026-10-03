-- Phase 19: Tenant branding

ALTER TABLE "tenants" ADD COLUMN "logo_path" TEXT;
ALTER TABLE "tenants" ADD COLUMN "primary_color" TEXT;
ALTER TABLE "tenants" ADD COLUMN "tagline" TEXT;
