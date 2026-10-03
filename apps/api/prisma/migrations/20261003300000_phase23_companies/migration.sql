-- Phase 23: Companies table + company_id on members

CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "logo_path" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "companies_tenant_id_idx" ON "companies"("tenant_id");
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "companies_tenant_id_name_key" ON "companies"("tenant_id", "name");

ALTER TABLE "members" ADD COLUMN "company_id" TEXT;
ALTER TABLE "members" ADD CONSTRAINT "members_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: create companies from existing distinct company_name values
DO $$
DECLARE
  r RECORD;
  new_id TEXT;
BEGIN
  FOR r IN SELECT DISTINCT tenant_id, company_name FROM members WHERE company_name IS NOT NULL AND company_name <> '' LOOP
    new_id := 'cmp_' || substr(md5(r.tenant_id || '|' || r.company_name), 1, 20);
    INSERT INTO companies (id, tenant_id, name, updated_at)
    VALUES (new_id, r.tenant_id, r.company_name, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, name) DO NOTHING;
    UPDATE members SET company_id = new_id
    WHERE tenant_id = r.tenant_id AND company_name = r.company_name AND company_id IS NULL;
  END LOOP;
END $$;
