-- Phase 33: Community & Engagement Pack

-- Community events + RSVPs
CREATE TABLE "community_events" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "title" TEXT NOT NULL,
    "description" TEXT, "starts_at" TIMESTAMP(3) NOT NULL, "ends_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT, "capacity" INTEGER, "image_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'upcoming', "created_by" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "community_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "community_events_tenant_id_status_idx" ON "community_events"("tenant_id", "status");
CREATE INDEX "community_events_tenant_id_starts_at_idx" ON "community_events"("tenant_id", "starts_at");
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_events" ADD CONSTRAINT "community_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "event_rsvps" (
    "id" TEXT NOT NULL, "event_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'going',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_rsvps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_rsvps_event_id_member_id_key" ON "event_rsvps"("event_id", "member_id");
CREATE INDEX "event_rsvps_event_id_idx" ON "event_rsvps"("event_id");
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Referrals
CREATE TABLE "referral_codes" (
  "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
  "code" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");
CREATE UNIQUE INDEX "referral_codes_tenant_id_member_id_key" ON "referral_codes"("tenant_id", "member_id");
CREATE INDEX "referral_codes_tenant_id_idx" ON "referral_codes"("tenant_id");
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "referrals" (
  "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "code_id" TEXT NOT NULL,
  "referred_name" TEXT NOT NULL, "referred_email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'invited', "reward_amount" DECIMAL(12,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "referrals_tenant_id_status_idx" ON "referrals"("tenant_id", "status");
CREATE INDEX "referrals_code_id_idx" ON "referrals"("code_id");
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "referral_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Loyalty
CREATE TABLE "loyalty_ledger" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "related_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loyalty_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "loyalty_ledger_tenant_id_idx" ON "loyalty_ledger"("tenant_id");
CREATE INDEX "loyalty_ledger_member_id_idx" ON "loyalty_ledger"("member_id");
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Marketplace
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT, "category" TEXT NOT NULL DEFAULT 'service',
    "price" DECIMAL(12,2), "contact_info" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active', "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "marketplace_listings_tenant_id_status_idx" ON "marketplace_listings"("tenant_id", "status");
CREATE INDEX "marketplace_listings_tenant_id_category_idx" ON "marketplace_listings"("tenant_id", "category");
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Surveys
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'nps', "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "surveys_tenant_id_status_idx" ON "surveys"("tenant_id", "status");
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL, "survey_id" TEXT NOT NULL, "member_id" TEXT,
    "score" INTEGER, "answers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "survey_responses_survey_id_member_id_key" ON "survey_responses"("survey_id", "member_id");
CREATE INDEX "survey_responses_survey_id_idx" ON "survey_responses"("survey_id");
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey"
  FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "survey_invites" (
    "id" TEXT NOT NULL, "survey_id" TEXT NOT NULL, "member_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "survey_invites_survey_id_member_id_key" ON "survey_invites"("survey_id", "member_id");
ALTER TABLE "survey_invites" ADD CONSTRAINT "survey_invites_survey_id_fkey"
  FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_invites" ADD CONSTRAINT "survey_invites_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Visitor invites
CREATE TABLE "visitor_invites" ("id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "member_id" TEXT NOT NULL, "visitor_name" TEXT NOT NULL, "visitor_email" TEXT, "visitor_phone" TEXT, "expected_at" TIMESTAMP(3) NOT NULL, "purpose" TEXT NOT NULL DEFAULT 'meeting', "notes" TEXT, "code" CHAR(6) NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "visitor_invites_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "visitor_invites_tenant_id_code_key" ON "visitor_invites"("tenant_id", "code");
CREATE INDEX "visitor_invites_tenant_id_status_expected_at_idx" ON "visitor_invites"("tenant_id", "status", "expected_at");
ALTER TABLE "visitor_invites" ADD CONSTRAINT "visitor_invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visitor_invites" ADD CONSTRAINT "visitor_invites_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Push subscriptions
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Announcements feed
ALTER TABLE "announcements" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "announcements" ADD COLUMN "expires_at" TIMESTAMP(3);
CREATE INDEX "announcements_pinned_idx" ON "announcements"("pinned");
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "announcement_reads_announcement_id_user_id_key" ON "announcement_reads"("announcement_id", "user_id");
CREATE INDEX "announcement_reads_announcement_id_idx" ON "announcement_reads"("announcement_id");
CREATE INDEX "announcement_reads_user_id_idx" ON "announcement_reads"("user_id");
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Member directory fields
ALTER TABLE "members" ADD COLUMN "directory_opt_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "members" ADD COLUMN "directory_bio" TEXT;
ALTER TABLE "members" ADD COLUMN "directory_tags" TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX "members_tenant_id_directory_opt_in_idx" ON "members"("tenant_id", "directory_opt_in");
