-- Phase 36: Integrations & API Pack
-- CalendarConnection + CalendarSyncLog
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "access_token" TEXT,
    "refresh_token" TEXT NOT NULL,
    "expiry" TIMESTAMP(3),
    "scope" TEXT,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_connections_user_id_provider_key" ON "calendar_connections"("user_id", "provider");
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "calendar_sync_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'synced',
    "error" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calendar_sync_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "calendar_sync_logs_booking_id_idx" ON "calendar_sync_logs"("booking_id");
CREATE INDEX "calendar_sync_logs_user_id_idx" ON "calendar_sync_logs"("user_id");
ALTER TABLE "calendar_sync_logs" ADD CONSTRAINT "calendar_sync_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_sync_logs" ADD CONSTRAINT "calendar_sync_logs_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SlackIntegration
CREATE TABLE "slack_integrations" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL,
    "webhook_url" TEXT NOT NULL, "channel" TEXT,
    "events" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "slack_integrations_tenant_id_key" ON "slack_integrations"("tenant_id");
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ContractSignature
CREATE TABLE "contract_signatures" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT NOT NULL,
    "token_hash" TEXT,
    "signature_image" TEXT,
    "signed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_signatures_token_hash_key" ON "contract_signatures"("token_hash");
CREATE INDEX "contract_signatures_tenant_id_status_idx" ON "contract_signatures"("tenant_id", "status");
CREATE INDEX "contract_signatures_contract_id_idx" ON "contract_signatures"("contract_id");
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EmailCampaign + EmailUnsubscribe
CREATE TABLE "email_campaigns" (
  "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL, "body_html" TEXT NOT NULL, "segment" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'draft', "scheduled_at" TIMESTAMP(3),
  "recipient_count" INTEGER NOT NULL DEFAULT 0, "sent_count" INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_campaigns_tenant_id_status_idx" ON "email_campaigns"("tenant_id", "status");
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "email_unsubscribes" (
  "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "email" TEXT NOT NULL,
  "token" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_unsubscribes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_unsubscribes_tenant_id_email_key" ON "email_unsubscribes"("tenant_id", "email");
CREATE UNIQUE INDEX "email_unsubscribes_token_key" ON "email_unsubscribes"("token");
CREATE INDEX "email_unsubscribes_tenant_id_idx" ON "email_unsubscribes"("tenant_id");
ALTER TABLE "email_unsubscribes" ADD CONSTRAINT "email_unsubscribes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ApiUsageLog + ApiKey.rateLimitPerMin
CREATE TABLE "api_usage_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "api_usage_logs_tenant_id_created_at_idx" ON "api_usage_logs"("tenant_id", "created_at");
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD COLUMN "rate_limit_per_min" INTEGER;

-- CalendarFeedToken
CREATE TABLE "calendar_feed_tokens" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calendar_feed_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calendar_feed_tokens_token_key" ON "calendar_feed_tokens"("token");
CREATE UNIQUE INDEX "calendar_feed_tokens_tenant_id_member_id_key" ON "calendar_feed_tokens"("tenant_id", "member_id");
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_feed_tokens" ADD CONSTRAINT "calendar_feed_tokens_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SmsCampaign
CREATE TABLE "sms_campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "segment" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sms_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sms_campaigns_tenant_id_idx" ON "sms_campaigns"("tenant_id");
ALTER TABLE "sms_campaigns" ADD CONSTRAINT "sms_campaigns_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
