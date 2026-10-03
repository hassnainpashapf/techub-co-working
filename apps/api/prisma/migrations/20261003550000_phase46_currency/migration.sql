-- Phase 46: Multi-Currency & International Pack

-- currency_settings (per-tenant currency config)
CREATE TABLE "currency_settings" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "base_currency" TEXT NOT NULL DEFAULT 'PKR',
  "enabled_currencies" JSONB,
  "default_invoice_currency" TEXT,
  "fx_source" TEXT NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "currency_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "currency_settings_tenant_id_key" UNIQUE ("tenant_id"),
  CONSTRAINT "currency_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- fx_rates
CREATE TABLE "fx_rates" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "from_currency" TEXT NOT NULL,
  "to_currency" TEXT NOT NULL,
  "rate" DECIMAL(18,6) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "effective_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_rates_tenant_id_from_currency_to_currency_effective_date_key" UNIQUE ("tenant_id", "from_currency", "to_currency", "effective_date"),
  CONSTRAINT "fx_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "fx_rates_tenant_id_from_currency_to_currency_effective_date_idx" ON "fx_rates"("tenant_id", "from_currency", "to_currency", "effective_date" DESC);

-- contracts.rent_currency
ALTER TABLE "contracts" ADD COLUMN "rent_currency" TEXT NOT NULL DEFAULT 'PKR';

-- invoices currency fields
ALTER TABLE "invoices" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PKR';
ALTER TABLE "invoices" ADD COLUMN "fx_rate" DECIMAL(18,6);
ALTER TABLE "invoices" ADD COLUMN "base_amount" DECIMAL(12,2);
CREATE INDEX "invoices_currency_idx" ON "invoices"("tenant_id", "currency");
UPDATE "invoices" SET "fx_rate" = 1, "base_amount" = "amount" WHERE "fx_rate" IS NULL;

-- payments currency fields
ALTER TABLE "payments" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PKR';
ALTER TABLE "payments" ADD COLUMN "fx_rate" DECIMAL(18,6);
ALTER TABLE "payments" ADD COLUMN "base_amount" DECIMAL(12,2);
CREATE INDEX "payments_tenant_currency_idx" ON "payments"("tenant_id","currency");
UPDATE "payments" SET "fx_rate" = 1, "base_amount" = "amount" WHERE "fx_rate" IS NULL;

-- fx_gain_loss
CREATE TABLE "fx_gain_loss" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "payment_id" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "expense_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fx_gain_loss_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fx_gain_loss_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fx_gain_loss_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fx_gain_loss_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "fx_gain_loss_tenant_id_created_at_idx" ON "fx_gain_loss"("tenant_id", "created_at");
CREATE INDEX "fx_gain_loss_tenant_id_invoice_id_idx" ON "fx_gain_loss"("tenant_id", "invoice_id");
CREATE INDEX "fx_gain_loss_tenant_id_payment_id_idx" ON "fx_gain_loss"("tenant_id", "payment_id");
