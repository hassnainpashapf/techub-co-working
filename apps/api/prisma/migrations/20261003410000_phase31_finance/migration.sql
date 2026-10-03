-- Phase 31: Finance Pro Pack
-- Migration: payroll, recurring invoices, dunning, gateways, petty cash, budgets, credit limits, proforma

-- Salary structures
CREATE TABLE "salary_structures" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "basic_salary" DECIMAL(12,2) NOT NULL,
    "allowances" JSONB NOT NULL DEFAULT '{}',
    "deductions" JSONB NOT NULL DEFAULT '{}',
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "salary_structures_user_id_effective_from_key" ON "salary_structures"("user_id", "effective_from");
CREATE INDEX "salary_structures_tenant_id_idx" ON "salary_structures"("tenant_id");
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payroll runs
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_runs_tenant_id_month_key" ON "payroll_runs"("tenant_id", "month");
CREATE INDEX "payroll_runs_tenant_id_idx" ON "payroll_runs"("tenant_id");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payslips
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gross_salary" DECIMAL(12,2) NOT NULL,
    "total_deductions" DECIMAL(12,2) NOT NULL,
    "net_pay" DECIMAL(12,2) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payslips_payroll_run_id_idx" ON "payslips"("payroll_run_id");
CREATE INDEX "payslips_user_id_idx" ON "payslips"("user_id");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recurring invoices
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "day_of_month" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_generated_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recurring_invoices_tenant_id_status_idx" ON "recurring_invoices"("tenant_id", "status");
CREATE INDEX "recurring_invoices_next_run_at_idx" ON "recurring_invoices"("next_run_at");
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dunning logs
CREATE TABLE "dunning_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    CONSTRAINT "dunning_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dunning_logs_invoice_id_level_key" ON "dunning_logs"("invoice_id", "level");
CREATE INDEX "dunning_logs_tenant_id_idx" ON "dunning_logs"("tenant_id");
CREATE INDEX "dunning_logs_invoice_id_idx" ON "dunning_logs"("invoice_id");
ALTER TABLE "dunning_logs" ADD CONSTRAINT "dunning_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dunning_logs" ADD CONSTRAINT "dunning_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Online payments (gateway framework)
CREATE TABLE "online_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gateway_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "online_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "online_payments_tenant_id_status_idx" ON "online_payments"("tenant_id", "status");
CREATE INDEX "online_payments_invoice_id_idx" ON "online_payments"("invoice_id");
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Budgets
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budgets_tenant_id_month_category_key" ON "budgets"("tenant_id", "month", "category");
CREATE INDEX "budgets_tenant_id_month_idx" ON "budgets"("tenant_id", "month");
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Petty cash transactions
CREATE TABLE "petty_cash_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "performed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "petty_cash_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "petty_cash_transactions_tenant_id_created_at_idx" ON "petty_cash_transactions"("tenant_id", "created_at");
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Member credit limit (null = unlimited)
ALTER TABLE "members" ADD COLUMN "credit_limit" DECIMAL(12,2);

-- Invoice type (standard | proforma)
ALTER TABLE "invoices" ADD COLUMN "invoice_type" TEXT NOT NULL DEFAULT 'standard';
CREATE INDEX "invoices_tenant_id_invoice_type_idx" ON "invoices"("tenant_id", "invoice_type");
