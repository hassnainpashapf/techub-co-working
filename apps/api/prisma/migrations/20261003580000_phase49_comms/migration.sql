-- Phase 49: Unified Communication Hub Pack
CREATE TABLE "comm_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'out',
  "member_id" TEXT,
  "user_id" TEXT,
  "to" TEXT,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "provider" TEXT,
  "external_id" TEXT,
  "error" TEXT,
  "scheduled_for" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "assigned_to_id" TEXT,
  "is_resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comm_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "comm_messages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "comm_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "comm_messages_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "comm_messages_tenant_id_idx" ON "comm_messages"("tenant_id");
CREATE INDEX "comm_messages_member_id_created_at_idx" ON "comm_messages"("member_id", "created_at");
CREATE INDEX "comm_messages_tenant_id_channel_idx" ON "comm_messages"("tenant_id", "channel");
CREATE INDEX "comm_messages_tenant_id_status_idx" ON "comm_messages"("tenant_id", "status");
CREATE INDEX "comm_messages_assigned_to_id_idx" ON "comm_messages"("assigned_to_id");
CREATE INDEX "comm_messages_is_resolved_idx" ON "comm_messages"("is_resolved");

CREATE TABLE whatsapp_settings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id TEXT,
  access_token_encrypted TEXT,
  verify_token_encrypted TEXT,
  app_secret_encrypted TEXT,
  business_number TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_settings_tenant_idx ON whatsapp_settings(tenant_id);

CREATE TABLE comm_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'any',
  subject TEXT,
  body TEXT NOT NULL,
  variables JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comm_templates_tenant_name_unique UNIQUE (tenant_id, name)
);
CREATE INDEX comm_templates_tenant_channel_idx ON comm_templates (tenant_id, channel);

CREATE TABLE auto_replies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  keyword TEXT,
  channel TEXT NOT NULL,
  reply_body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auto_replies_tenant_idx ON auto_replies(tenant_id);
