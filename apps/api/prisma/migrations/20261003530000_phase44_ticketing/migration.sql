-- Phase 44: Events & Ticketing Pro Pack

-- CommunityEvent public ticketing fields
ALTER TABLE "community_events" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "community_events" ADD COLUMN "slug" TEXT;
ALTER TABLE "community_events" ADD COLUMN "external_url" TEXT;
CREATE UNIQUE INDEX "community_events_tenant_id_slug_key" ON "community_events"("tenant_id", "slug");
CREATE INDEX "community_events_is_public_starts_at_idx" ON "community_events"("is_public", "starts_at");

-- Ticket types
CREATE TABLE "ticket_types" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "sale_start" TIMESTAMP(3),
    "sale_end" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "per_order_limit" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_types_tenant_id_event_id_idx" ON "ticket_types"("tenant_id", "event_id");
CREATE INDEX "ticket_types_event_id_is_active_idx" ON "ticket_types"("event_id", "is_active");
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Event tickets
CREATE TABLE "event_tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "ticket_type_id" TEXT NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_email" TEXT NOT NULL,
    "buyer_phone" TEXT,
    "member_id" TEXT,
    "code" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'valid',
    "price" DECIMAL(12,2) NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),
    "refund_reason" TEXT,
    "refunded_at" TIMESTAMP(3),
    CONSTRAINT "event_tickets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_tickets_tenant_id_event_id_idx" ON "event_tickets"("tenant_id", "event_id");
CREATE INDEX "event_tickets_tenant_id_buyer_email_idx" ON "event_tickets"("tenant_id", "buyer_email");
CREATE INDEX "event_tickets_ticket_type_id_status_idx" ON "event_tickets"("ticket_type_id", "status");
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_ticket_type_id_fkey"
  FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ticket transfers
CREATE TABLE "ticket_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "to_name" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "transferred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_transfers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_transfers_tenant_id_ticket_id_idx" ON "ticket_transfers"("tenant_id", "ticket_id");
CREATE INDEX "ticket_transfers_to_email_idx" ON "ticket_transfers"("to_email");
ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_transfers" ADD CONSTRAINT "ticket_transfers_ticket_id_fkey"
  FOREIGN KEY ("ticket_id") REFERENCES "event_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Event sponsors
CREATE TABLE "event_sponsors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'silver',
    "logo_url" TEXT,
    "website" TEXT,
    "amount" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_sponsors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_sponsors_tenant_id_idx" ON "event_sponsors"("tenant_id");
CREATE INDEX "event_sponsors_event_id_idx" ON "event_sponsors"("event_id");
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Event speakers
CREATE TABLE "event_speakers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "company" TEXT,
    "bio" TEXT,
    "photo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_speakers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_speakers_event_id_idx" ON "event_speakers"("event_id");
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Event sessions
CREATE TABLE "event_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "speaker_id" TEXT,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_sessions_event_id_idx" ON "event_sessions"("event_id");
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "community_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_speaker_id_fkey"
  FOREIGN KEY ("speaker_id") REFERENCES "event_speakers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
