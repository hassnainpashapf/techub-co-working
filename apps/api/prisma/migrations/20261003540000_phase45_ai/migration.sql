-- Phase 45: AI & Intelligence Pack
-- ai_settings (per-tenant AI provider config)
CREATE TABLE "ai_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'disabled',
  "api_key_encrypted" TEXT,
  "base_url" TEXT,
  "model" TEXT,
  "enabled_features" JSONB,
  "monthly_token_cap" INTEGER,
  "tokens_used_this_month" INTEGER NOT NULL DEFAULT 0,
  "usage_month" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_settings_tenant_id_key" UNIQUE ("tenant_id"),
  CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- insights (weekly AI insight cards)
CREATE TABLE "insights" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "week" DATE NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "data" JSONB,
  "is_read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "insights_tenant_id_week_type_key" ON "insights"("tenant_id", "week", "type");
CREATE INDEX "insights_tenant_id_week_idx" ON "insights"("tenant_id", "week");
CREATE INDEX "insights_tenant_id_is_read_idx" ON "insights"("tenant_id", "is_read");
ALTER TABLE "insights" ADD CONSTRAINT "insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- feedback sentiment delta
ALTER TABLE "feedback" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "feedback" ADD COLUMN "sentiment_score" DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS "feedback_tenant_sentiment_idx" ON "feedback"("tenant_id", "sentiment");
