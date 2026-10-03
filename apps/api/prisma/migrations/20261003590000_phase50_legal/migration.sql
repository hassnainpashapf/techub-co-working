-- Phase 50: Legal & Compliance Pack
CREATE TABLE "legal_templates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "variables" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "legal_templates_tenant_id_name_key" UNIQUE ("tenant_id", "name")
);
CREATE INDEX "legal_templates_tenant_id_idx" ON "legal_templates"("tenant_id");

CREATE TABLE "Policy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'general',
  "fileUrl" TEXT,
  "body" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "effectiveDate" TIMESTAMP(3),
  "requiresAck" BOOLEAN NOT NULL DEFAULT true,
  "reAckOnUpdate" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Policy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Policy_tenantId_isActive_idx" ON "Policy"("tenantId", "isActive");

CREATE TABLE "PolicyAck" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "memberId" TEXT,
  "userId" TEXT,
  "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipHash" TEXT,
  CONSTRAINT "PolicyAck_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PolicyAck_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PolicyAck_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PolicyAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PolicyAck_policyId_memberId_key" UNIQUE ("policyId", "memberId"),
  CONSTRAINT "PolicyAck_policyId_userId_key" UNIQUE ("policyId", "userId")
);
CREATE INDEX "PolicyAck_tenantId_policyId_idx" ON "PolicyAck"("tenantId", "policyId");

CREATE TABLE "ComplianceItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3),
  "frequency" TEXT NOT NULL DEFAULT 'once',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "assignedToId" TEXT,
  "evidenceUrl" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ComplianceItem_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ComplianceItem_tenantId_status_idx" ON "ComplianceItem"("tenantId", "status");
CREATE INDEX "ComplianceItem_tenantId_dueDate_idx" ON "ComplianceItem"("tenantId", "dueDate");

CREATE TABLE "legal_documents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "file_url" TEXT,
  "file_name" TEXT,
  "file_mime" TEXT,
  "file_size" INTEGER,
  "related_member_id" TEXT,
  "related_vendor_id" TEXT,
  "expires_at" TIMESTAMP(3),
  "reminder_days" JSONB NOT NULL DEFAULT '[30,7,1]',
  "last_reminder_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "legal_documents_related_member_id_fkey" FOREIGN KEY ("related_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "legal_documents_related_vendor_id_fkey" FOREIGN KEY ("related_vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "legal_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "legal_documents_tenant_category_idx" ON "legal_documents"("tenant_id", "category");
CREATE INDEX "legal_documents_tenant_status_idx" ON "legal_documents"("tenant_id", "status");
CREATE INDEX "legal_documents_expires_at_idx" ON "legal_documents"("expires_at");

CREATE TABLE "Incident" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "location" TEXT,
  "reportedBy" TEXT NOT NULL,
  "reportedByName" TEXT,
  "involvedMemberId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolution" TEXT,
  "attachments" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Incident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Incident_involvedMemberId_fkey" FOREIGN KEY ("involvedMemberId") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Incident_tenantId_status_createdAt_idx" ON "Incident"("tenantId", "status", "createdAt");
CREATE INDEX "Incident_tenantId_severity_createdAt_idx" ON "Incident"("tenantId", "severity", "createdAt");

CREATE TABLE "InsurancePolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "policyNumber" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "coverageAmount" NUMERIC(14,2) NOT NULL,
  "premiumAmount" NUMERIC(14,2) NOT NULL,
  "premiumFrequency" TEXT NOT NULL DEFAULT 'yearly',
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "documentUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastReminderKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InsurancePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "InsurancePolicy_tenantId_status_idx" ON "InsurancePolicy"("tenantId", "status");
CREATE INDEX "InsurancePolicy_tenantId_endDate_idx" ON "InsurancePolicy"("tenantId", "endDate");

CREATE TABLE "retention_policies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "data_type" TEXT NOT NULL,
  "retain_days" INTEGER NOT NULL,
  "auto_delete" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "retention_policies_tenant_id_data_type_key" UNIQUE ("tenant_id", "data_type")
);
CREATE INDEX "retention_policies_tenant_id_idx" ON "retention_policies"("tenant_id");

CREATE TABLE "retention_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "policy_id" TEXT,
  "data_type" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "anonymized" INTEGER NOT NULL DEFAULT 0,
  "details" JSONB,
  "run_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "retention_runs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "retention_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "retention_runs_tenant_id_created_at_idx" ON "retention_runs"("tenant_id", "created_at");

-- Vendor compliance delta
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "compliance_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "compliance_docs" JSONB;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "compliance_expiry" DATE;
UPDATE "vendors" SET "compliance_status" = 'expired' WHERE "compliance_expiry" IS NOT NULL AND "compliance_expiry" < CURRENT_DATE;
CREATE INDEX IF NOT EXISTS "vendors_compliance_idx" ON "vendors" ("tenant_id", "compliance_status");
