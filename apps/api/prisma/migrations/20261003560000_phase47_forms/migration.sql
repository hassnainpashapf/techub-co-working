-- Phase 47: Custom Forms & Surveys Builder Pack
CREATE TABLE "CustomForm" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "fields" JSONB NOT NULL DEFAULT '[]',
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "submitButtonText" TEXT,
  "successMessage" TEXT,
  "notifyEmails" JSONB,
  "autoCreateLead" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CustomForm_tenantId_slug_key" ON "CustomForm"("tenantId", "slug");
CREATE INDEX "CustomForm_tenantId_status_idx" ON "CustomForm"("tenantId", "status");
CREATE INDEX "CustomForm_tenantId_isPublic_status_idx" ON "CustomForm"("tenantId", "isPublic", "status");

CREATE TABLE "FormSubmission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "formId" TEXT NOT NULL REFERENCES "CustomForm"("id") ON DELETE CASCADE,
  "answers" JSONB NOT NULL DEFAULT '{}',
  "submitterName" TEXT,
  "submitterEmail" TEXT,
  "memberId" TEXT,
  "ipHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "assignedToId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FormSubmission_tenantId_formId_idx" ON "FormSubmission"("tenantId", "formId");
CREATE INDEX "FormSubmission_formId_createdAt_idx" ON "FormSubmission"("formId", "createdAt");
CREATE INDEX "FormSubmission_tenantId_submitterEmail_idx" ON "FormSubmission"("tenantId", "submitterEmail");
CREATE INDEX "FormSubmission_tenantId_status_idx" ON "FormSubmission"("tenantId", "status");
CREATE INDEX "FormSubmission_formId_status_idx" ON "FormSubmission"("formId", "status");
