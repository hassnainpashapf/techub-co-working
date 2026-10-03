-- Phase 40: Member Engagement Pack
-- New tables: celebration_logs, perks, perk_claims, conversations, conversation_participants,
-- messages, polls, poll_votes, badges, member_badges, event_checkins, newsletters,
-- newsletter_sends, member_intros. Members table: date_of_birth column.

ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "date_of_birth" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "celebration_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "celebration_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "celebration_logs_member_id_kind_year_key" ON "celebration_logs"("member_id", "kind", "year");
CREATE INDEX IF NOT EXISTS "celebration_logs_tenant_id_year_idx" ON "celebration_logs"("tenant_id", "year");

CREATE TABLE IF NOT EXISTS "perks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "partner_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discount_text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "code" TEXT,
    "expiry_date" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "perks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "perks_tenant_id_is_active_idx" ON "perks"("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "perk_claims" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "perk_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "perk_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "perk_claims_perk_id_member_id_key" ON "perk_claims"("perk_id", "member_id");
CREATE INDEX IF NOT EXISTS "perk_claims_tenant_id_idx" ON "perk_claims"("tenant_id");
CREATE INDEX IF NOT EXISTS "perk_claims_member_id_idx" ON "perk_claims"("member_id");

CREATE TABLE IF NOT EXISTS "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'direct',
    "title" TEXT,
    "ticket_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_updated_at_idx" ON "conversations"("tenant_id", "updated_at");

CREATE TABLE IF NOT EXISTS "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT,
    "member_id" TEXT,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversation_id_user_id_key" ON "conversation_participants"("conversation_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversation_id_member_id_key" ON "conversation_participants"("conversation_id", "member_id");
CREATE INDEX IF NOT EXISTS "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");
CREATE INDEX IF NOT EXISTS "conversation_participants_member_id_idx" ON "conversation_participants"("member_id");

CREATE TABLE IF NOT EXISTS "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_user_id" TEXT,
    "sender_member_id" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "read_by" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

CREATE TABLE IF NOT EXISTS "polls" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "closes_at" TIMESTAMPTZ,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "polls_tenant_id_status_idx" ON "polls"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "poll_votes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "voted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "poll_votes_poll_id_member_id_key" ON "poll_votes"("poll_id", "member_id");
CREATE INDEX IF NOT EXISTS "poll_votes_tenant_id_idx" ON "poll_votes"("tenant_id");
CREATE INDEX IF NOT EXISTS "poll_votes_poll_id_idx" ON "poll_votes"("poll_id");

CREATE TABLE IF NOT EXISTS "badges" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "badges_tenant_id_key_key" ON "badges"("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "badges_tenant_id_idx" ON "badges"("tenant_id");

CREATE TABLE IF NOT EXISTS "member_badges" (
    "id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "awarded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_badges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_badges_badge_id_member_id_key" ON "member_badges"("badge_id", "member_id");
CREATE INDEX IF NOT EXISTS "member_badges_member_id_idx" ON "member_badges"("member_id");

CREATE TABLE IF NOT EXISTS "event_checkins" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "checked_in_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by" TEXT,
    "method" TEXT NOT NULL DEFAULT 'manual',
    CONSTRAINT "event_checkins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "event_checkins_event_id_member_id_key" ON "event_checkins"("event_id", "member_id");
CREATE INDEX IF NOT EXISTS "event_checkins_event_id_idx" ON "event_checkins"("event_id");
CREATE INDEX IF NOT EXISTS "event_checkins_member_id_idx" ON "event_checkins"("member_id");

CREATE TABLE IF NOT EXISTS "newsletters" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "segment" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduled_for" TIMESTAMPTZ,
    "sent_at" TIMESTAMPTZ,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletters_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "newsletters_tenant_id_status_idx" ON "newsletters"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "newsletter_sends" (
    "id" TEXT NOT NULL,
    "newsletter_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "newsletter_sends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_sends_newsletter_id_member_id_key" ON "newsletter_sends"("newsletter_id", "member_id");
CREATE INDEX IF NOT EXISTS "newsletter_sends_newsletter_id_idx" ON "newsletter_sends"("newsletter_id");

CREATE TABLE IF NOT EXISTS "member_intros" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "new_member_id" TEXT NOT NULL,
    "suggested_member_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "member_intros_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_intros_tenant_id_new_member_id_suggested_member_id_key" ON "member_intros"("tenant_id", "new_member_id", "suggested_member_id");
CREATE INDEX IF NOT EXISTS "member_intros_tenant_id_status_idx" ON "member_intros"("tenant_id", "status");

-- Foreign keys (NOT VALID to avoid scanning existing empty tables; validated on deploy via migrate deploy).
DO $$ BEGIN
  ALTER TABLE "celebration_logs" ADD CONSTRAINT "celebration_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "celebration_logs" ADD CONSTRAINT "celebration_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "perks" ADD CONSTRAINT "perks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "perk_claims" ADD CONSTRAINT "perk_claims_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "perk_claims" ADD CONSTRAINT "perk_claims_perk_id_fkey" FOREIGN KEY ("perk_id") REFERENCES "perks"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "perk_claims" ADD CONSTRAINT "perk_claims_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_member_id_fkey" FOREIGN KEY ("sender_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "polls" ADD CONSTRAINT "polls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "badges" ADD CONSTRAINT "badges_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "member_badges" ADD CONSTRAINT "member_badges_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "event_checkins" ADD CONSTRAINT "event_checkins_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "event_checkins" ADD CONSTRAINT "event_checkins_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "newsletters" ADD CONSTRAINT "newsletters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_newsletter_id_fkey" FOREIGN KEY ("newsletter_id") REFERENCES "newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "member_intros" ADD CONSTRAINT "member_intros_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "member_intros" ADD CONSTRAINT "member_intros_new_member_id_fkey" FOREIGN KEY ("new_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "member_intros" ADD CONSTRAINT "member_intros_suggested_member_id_fkey" FOREIGN KEY ("suggested_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
