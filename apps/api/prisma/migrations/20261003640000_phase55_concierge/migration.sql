-- Phase 55: Concierge & Lifestyle Services Pack

CREATE TABLE "service_providers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "contact_name" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "rating_avg" DOUBLE PRECISION,
  "rating_count" INT NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "service_providers_tenant_id_category_idx" ON "service_providers"("tenant_id", "category");
CREATE INDEX "service_providers_tenant_id_is_active_idx" ON "service_providers"("tenant_id", "is_active");

CREATE TABLE "concierge_services" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT,
  "base_price" DECIMAL(14,2),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "provider_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "concierge_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "concierge_services_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "service_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "concierge_services_tenant_id_category_idx" ON "concierge_services"("tenant_id", "category");
CREATE INDEX "concierge_services_tenant_id_is_active_idx" ON "concierge_services"("tenant_id", "is_active");

CREATE TABLE "service_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "service_id" TEXT,
  "title" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'new',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "assigned_to" TEXT,
  "price" DECIMAL(12,2),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_requests_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "concierge_services"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "service_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "service_requests_tenant_id_status_idx" ON "service_requests"("tenant_id", "status");
CREATE INDEX "service_requests_tenant_id_member_id_idx" ON "service_requests"("tenant_id", "member_id");
CREATE INDEX "service_requests_tenant_id_assigned_to_idx" ON "service_requests"("tenant_id", "assigned_to");

CREATE TABLE "request_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "request_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "request_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "request_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "request_messages_tenant_id_request_id_created_at_idx" ON "request_messages"("tenant_id", "request_id", "created_at");

CREATE TABLE "service_ratings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_ratings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_ratings_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_ratings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "service_ratings_request_id_key" ON "service_ratings"("request_id");
CREATE INDEX "service_ratings_tenant_id_member_id_idx" ON "service_ratings"("tenant_id", "member_id");
