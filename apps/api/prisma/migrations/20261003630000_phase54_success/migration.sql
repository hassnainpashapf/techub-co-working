-- Phase 54: Member Success & Onboarding Pack
-- Note: Phase 42 me already staff-side "onboarding_templates" table hai;
-- member journeys ke liye alag tables: member_journey_templates / member_journeys.

CREATE TABLE "member_journey_templates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stages" JSONB NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "member_journey_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "member_journey_templates_tenant_id_is_default_idx" ON "member_journey_templates"("tenant_id", "is_default");

CREATE TABLE "member_journeys" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "template_id" TEXT,
  "template_name" TEXT NOT NULL DEFAULT '',
  "stage_tasks" JSONB NOT NULL DEFAULT '[]',
  "current_stage" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "member_journeys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_journeys_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_journeys_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "member_journey_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "member_journeys_tenant_id_member_id_status_idx" ON "member_journeys"("tenant_id", "member_id", "status");
CREATE INDEX "member_journeys_tenant_id_status_idx" ON "member_journeys"("tenant_id", "status");

CREATE TABLE "member_health" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL UNIQUE,
  "score" INTEGER NOT NULL DEFAULT 50 CHECK ("score" BETWEEN 0 AND 100),
  "factors" JSONB NOT NULL DEFAULT '{}',
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "member_health_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "member_health_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "member_health_tenant_id_score_idx" ON "member_health"("tenant_id", "score");

CREATE TABLE "welcome_sequences" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "steps" JSONB NOT NULL DEFAULT '[]',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "welcome_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "welcome_sequences_tenant_id_is_active_idx" ON "welcome_sequences"("tenant_id", "is_active");

CREATE TABLE "welcome_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "sequence_id" TEXT NOT NULL,
  "step_index" INT NOT NULL,
  "channel" TEXT NOT NULL,
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "error" TEXT,
  CONSTRAINT "welcome_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "welcome_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "welcome_logs_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "welcome_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "welcome_logs_sequence_id_member_id_step_index_key" ON "welcome_logs"("sequence_id", "member_id", "step_index");
CREATE INDEX "welcome_logs_tenant_id_member_id_idx" ON "welcome_logs"("tenant_id", "member_id");

CREATE TABLE "buddy_pairs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "newcomer_id" TEXT NOT NULL,
  "buddy_id" TEXT NOT NULL,
  "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "buddy_pairs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buddy_pairs_newcomer_id_fkey" FOREIGN KEY ("newcomer_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buddy_pairs_buddy_id_fkey" FOREIGN KEY ("buddy_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "buddy_pairs_no_self_pair" CHECK ("newcomer_id" <> "buddy_id")
);
CREATE UNIQUE INDEX "buddy_pairs_newcomer_id_buddy_id_key" ON "buddy_pairs"("newcomer_id", "buddy_id");
CREATE INDEX "buddy_pairs_tenant_id_status_idx" ON "buddy_pairs"("tenant_id", "status");
CREATE INDEX "buddy_pairs_buddy_id_idx" ON "buddy_pairs"("buddy_id");
CREATE INDEX "buddy_pairs_newcomer_id_idx" ON "buddy_pairs"("newcomer_id");

CREATE TABLE "onboarding_feedback" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "score" INTEGER NOT NULL CHECK ("score" BETWEEN 0 AND 10),
  "comment" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "onboarding_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "onboarding_feedback_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "onboarding_feedback_tenant_id_member_id_key" ON "onboarding_feedback"("tenant_id", "member_id");
CREATE INDEX "onboarding_feedback_tenant_id_submitted_at_idx" ON "onboarding_feedback"("tenant_id", "submitted_at");

CREATE TABLE "success_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "assigned_to" TEXT,
  "notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "created_by" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "success_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "success_tasks_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "success_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "success_tasks_tenant_id_status_idx" ON "success_tasks"("tenant_id", "status");
CREATE INDEX "success_tasks_tenant_id_member_id_idx" ON "success_tasks"("tenant_id", "member_id");
CREATE INDEX "success_tasks_tenant_id_assigned_to_idx" ON "success_tasks"("tenant_id", "assigned_to");

CREATE TABLE "winback_campaigns" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "target_filter" JSONB NOT NULL DEFAULT '{}',
  "offer_text" TEXT,
  "subject" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sent_count" INT NOT NULL DEFAULT 0,
  "last_run_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "winback_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "winback_campaigns_tenant_id_status_idx" ON "winback_campaigns"("tenant_id", "status");

CREATE TABLE "winback_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'sent',
  "error" TEXT,
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "winback_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "winback_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "winback_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "winback_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "winback_logs_campaign_id_member_id_key" ON "winback_logs"("campaign_id", "member_id");
CREATE INDEX "winback_logs_tenant_id_member_id_idx" ON "winback_logs"("tenant_id", "member_id");
