-- Phase 38: Automation & Growth Pack

-- Track 1: Scheduled reports
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "format" TEXT NOT NULL DEFAULT 'pdf',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scheduled_reports_tenant_id_idx" ON "scheduled_reports"("tenant_id");
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Track 2: Lifecycle automation
CREATE TABLE "lifecycle_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'email',
    "template_key" TEXT,
    "message" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lifecycle_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lifecycle_rules_tenant_id_trigger_key" ON "lifecycle_rules"("tenant_id", "trigger");
CREATE INDEX "lifecycle_rules_tenant_id_idx" ON "lifecycle_rules"("tenant_id");
ALTER TABLE "lifecycle_rules" ADD CONSTRAINT "lifecycle_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "lifecycle_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lifecycle_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lifecycle_runs_tenant_id_idx" ON "lifecycle_runs"("tenant_id");
CREATE INDEX "lifecycle_runs_rule_id_member_id_idx" ON "lifecycle_runs"("rule_id", "member_id");
CREATE INDEX "lifecycle_runs_sent_at_idx" ON "lifecycle_runs"("sent_at");
ALTER TABLE "lifecycle_runs" ADD CONSTRAINT "lifecycle_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lifecycle_runs" ADD CONSTRAINT "lifecycle_runs_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "lifecycle_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lifecycle_runs" ADD CONSTRAINT "lifecycle_runs_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Track 3: Email template editor (extend existing email_templates)
ALTER TABLE "email_templates" ADD COLUMN "variables" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "email_templates" ADD COLUMN "is_custom" BOOLEAN NOT NULL DEFAULT FALSE;

-- Track 6: Task automation rules
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL, "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "automation_rules_tenant_id_idx" ON "automation_rules"("tenant_id");
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "rule_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL, "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "automation_runs_rule_id_idx" ON "automation_runs"("rule_id");
CREATE INDEX "automation_runs_tenant_id_trigger_created_at_idx" ON "automation_runs"("tenant_id", "trigger", "created_at");
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Track 7: Document expiry tracking (extend existing documents)
ALTER TABLE "documents" ADD COLUMN "issued_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "reminder_days" JSONB NOT NULL DEFAULT '[30,7,1]';
ALTER TABLE "documents" ADD COLUMN "last_reminder_key" TEXT;
CREATE INDEX "documents_expires_at_idx" ON "documents"("expires_at");

-- Track 8: Waiting list
CREATE TABLE "waiting_list_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "desired_type" TEXT,
    "desired_date" TIMESTAMP(3),
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "offers_made" INTEGER NOT NULL DEFAULT 0,
    "offered_at" TIMESTAMP(3),
    "converted_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "waiting_list_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "waiting_list_entries_converted_member_id_key" ON "waiting_list_entries"("converted_member_id");
CREATE INDEX "waiting_list_entries_tenant_id_status_idx" ON "waiting_list_entries"("tenant_id", "status");
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "waiting_list_entries" ADD CONSTRAINT "waiting_list_entries_converted_member_id_fkey"
  FOREIGN KEY ("converted_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Track 9: Feedback & suggestions box (extend existing feedback)
ALTER TABLE "feedback" ADD COLUMN "title" TEXT;
ALTER TABLE "feedback" RENAME COLUMN "message" TO "body";
ALTER TABLE "feedback" ALTER COLUMN "member_id" DROP NOT NULL;
ALTER TABLE "feedback" ADD COLUMN "is_anonymous" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "feedback" ADD COLUMN "upvotes" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "feedback_upvotes" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "feedback_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_upvotes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "feedback_upvotes_feedback_id_member_id_key" ON "feedback_upvotes"("feedback_id", "member_id");
CREATE INDEX "feedback_upvotes_tenant_id_idx" ON "feedback_upvotes"("tenant_id");
ALTER TABLE "feedback_upvotes" ADD CONSTRAINT "feedback_upvotes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_upvotes" ADD CONSTRAINT "feedback_upvotes_feedback_id_fkey"
  FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Track 10: Smart reminders engine
CREATE TABLE "reminder_rules" (
  "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "entity" TEXT NOT NULL, "timing" TEXT NOT NULL, "days_offset" INTEGER NOT NULL,
  "channels" TEXT[] NOT NULL DEFAULT '{}', "template_key" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reminder_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reminder_rules_tenant_id_is_active_idx" ON "reminder_rules"("tenant_id", "is_active");
ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "reminder_logs" (
  "id" TEXT NOT NULL, "rule_id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL, "channels_sent" TEXT[] NOT NULL DEFAULT '{}',
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reminder_logs_rule_id_entity_id_key" ON "reminder_logs"("rule_id", "entity_id");
CREATE INDEX "reminder_logs_tenant_id_sent_at_idx" ON "reminder_logs"("tenant_id", "sent_at");
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "reminder_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
