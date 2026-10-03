-- Phase 32: Security & Reliability Pack

-- refresh_tokens (DB-backed opaque refresh token rotation)
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_sessions (login devices / session manager)
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_name" TEXT,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- login_alerts (new-device / suspicious login alerts)
CREATE TABLE "login_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT,
    "type" TEXT NOT NULL DEFAULT 'new_device',
    "acknowledged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "login_alerts_tenant_id_created_at_idx" ON "login_alerts"("tenant_id", "created_at");
CREATE INDEX "login_alerts_tenant_id_user_id_idx" ON "login_alerts"("tenant_id", "user_id");
CREATE INDEX "login_alerts_tenant_id_ip_address_idx" ON "login_alerts"("tenant_id", "ip_address");
ALTER TABLE "login_alerts" ADD CONSTRAINT "login_alerts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "login_alerts" ADD CONSTRAINT "login_alerts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- audit_archives (audit log retention archives)
CREATE TABLE "audit_archives" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "record_count" INTEGER NOT NULL,
    "file_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_archives_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_archives_tenant_id_created_at_idx" ON "audit_archives"("tenant_id", "created_at");
ALTER TABLE "audit_archives" ADD CONSTRAINT "audit_archives_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- backup_records (automated backup history)
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "backup_records_created_at_idx" ON "backup_records"("created_at");
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- job-retry-delays: per-job custom retry schedule
ALTER TABLE "jobs" ADD COLUMN "retry_delays" JSONB;
