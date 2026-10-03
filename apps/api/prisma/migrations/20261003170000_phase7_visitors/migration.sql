-- Phase 7: Visitor management

CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "cnic" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'meeting',
    "host_member_id" TEXT,
    "host_name" TEXT,
    "check_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "check_out_at" TIMESTAMP(3),
    "badge_no" TEXT,
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visitors_tenant_id_check_in_at_idx" ON "visitors"("tenant_id", "check_in_at");
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_host_member_id_fkey"
  FOREIGN KEY ("host_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
