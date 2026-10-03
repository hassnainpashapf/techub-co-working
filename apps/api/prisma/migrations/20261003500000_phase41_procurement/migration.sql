-- Phase 41: Vendor & Procurement Pack
-- New tables: vendors, purchase_orders, po_approvals, goods_receipts, vendor_bills,
-- vendor_payments, vendor_ratings, vendor_contracts.
-- inventory_items: last_restocked_at column.

CREATE TABLE IF NOT EXISTS "vendors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "payment_terms" TEXT NOT NULL DEFAULT 'net_30',
    "tax_id" TEXT,
    "rating" DECIMAL(3,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vendors_tenant_id_is_active_idx" ON "vendors"("tenant_id", "is_active");
CREATE INDEX IF NOT EXISTS "vendors_tenant_id_category_idx" ON "vendors"("tenant_id", "category");

CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "requested_by" TEXT,
    "approved_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_orders_tenant_id_number_key" UNIQUE ("tenant_id", "number"),
    CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "purchase_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_id_vendor_id_idx" ON "purchase_orders"("tenant_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_id_status_idx" ON "purchase_orders"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "po_approvals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT TRUE,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "po_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "po_approvals_tenant_id_po_id_level_key" UNIQUE ("tenant_id", "po_id", "level"),
    CONSTRAINT "po_approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "po_approvals_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "po_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "po_approvals_tenant_id_po_id_idx" ON "po_approvals"("tenant_id", "po_id");

CREATE TABLE IF NOT EXISTS "goods_receipts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "received_by" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items_received" JSONB NOT NULL,
    "discrepancies" TEXT,
    "status" TEXT NOT NULL DEFAULT 'complete',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goods_receipts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goods_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "goods_receipts_tenant_id_idx" ON "goods_receipts"("tenant_id");
CREATE INDEX IF NOT EXISTS "goods_receipts_po_id_idx" ON "goods_receipts"("po_id");

CREATE TABLE IF NOT EXISTS "vendor_bills" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_no" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "po_id" TEXT,
    "grn_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dispute_reason" TEXT,
    "paid_at" TIMESTAMPTZ,
    "expense_id" TEXT,
    "approved_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vendor_bills_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "vendor_bills_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "vendor_bills_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "goods_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "vendor_bills_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vendor_bills_tenant_id_status_idx" ON "vendor_bills"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "vendor_bills_tenant_id_vendor_id_idx" ON "vendor_bills"("tenant_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "vendor_bills_tenant_id_due_date_idx" ON "vendor_bills"("tenant_id", "due_date");

CREATE TABLE IF NOT EXISTS "vendor_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'bank',
    "reference" TEXT,
    "paid_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vendor_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vendor_payments_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vendor_payments_tenant_id_bill_id_idx" ON "vendor_payments"("tenant_id", "bill_id");
CREATE INDEX IF NOT EXISTS "vendor_payments_tenant_id_paid_at_idx" ON "vendor_payments"("tenant_id", "paid_at");

CREATE TABLE IF NOT EXISTS "vendor_ratings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "rated_by" TEXT NOT NULL,
    "score" INTEGER NOT NULL CHECK ("score" BETWEEN 1 AND 5),
    "criteria" TEXT NOT NULL DEFAULT 'quality',
    "comment" TEXT,
    "rated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_ratings_vendor_id_rated_by_key" UNIQUE ("vendor_id", "rated_by"),
    CONSTRAINT "vendor_ratings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vendor_ratings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vendor_ratings_rated_by_fkey" FOREIGN KEY ("rated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vendor_ratings_tenant_id_vendor_id_idx" ON "vendor_ratings"("tenant_id", "vendor_id");

CREATE TABLE IF NOT EXISTS "vendor_contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start_date" TIMESTAMPTZ,
    "end_date" TIMESTAMPTZ NOT NULL,
    "value" DECIMAL(12,2),
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "document_url" TEXT,
    "reminder_days" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_reminder_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_contracts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vendor_contracts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vendor_contracts_tenant_id_status_idx" ON "vendor_contracts"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "vendor_contracts_tenant_id_end_date_idx" ON "vendor_contracts"("tenant_id", "end_date");

ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "last_restocked_at" TIMESTAMPTZ;
