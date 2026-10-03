-- Phase 42: HR & Payroll Pro Pack

-- Employees
CREATE TABLE "employees" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" TEXT UNIQUE,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "department" TEXT NOT NULL DEFAULT 'ops',
  "designation" TEXT NOT NULL DEFAULT 'Staff',
  "joining_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "employment_type" TEXT NOT NULL DEFAULT 'full_time',
  "status" TEXT NOT NULL DEFAULT 'active',
  "emergency_contact" TEXT,
  "cnic" TEXT,
  "address" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "employees_tenant_id_status_idx" ON "employees"("tenant_id", "status");
CREATE INDEX "employees_tenant_id_department_idx" ON "employees"("tenant_id", "department");

-- Staff attendance
CREATE TABLE "staff_attendance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" TIMESTAMP(3) NOT NULL,
  "check_in" TIMESTAMP(3),
  "check_out" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'present',
  "late_minutes" INTEGER,
  "worked_minutes" INTEGER,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "staff_attendance_tenant_id_employee_id_date_key" ON "staff_attendance"("tenant_id", "employee_id", "date");
CREATE INDEX "staff_attendance_tenant_id_date_idx" ON "staff_attendance"("tenant_id", "date");
CREATE INDEX "staff_attendance_employee_id_date_idx" ON "staff_attendance"("employee_id", "date");

-- Leaves delta (existing model)
ALTER TABLE "leaves" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'annual';
ALTER TABLE "leaves" ADD COLUMN IF NOT EXISTS "days" INTEGER NOT NULL DEFAULT 1;

-- Leave balances
CREATE TABLE "leave_balances" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "year" INTEGER NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'annual',
  "allocated" INTEGER NOT NULL DEFAULT 0,
  "used" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "leave_balances_tenant_employee_year_type_key" ON "leave_balances"("tenant_id", "employee_id", "year", "type");
CREATE INDEX "leave_balances_tenant_id_year_idx" ON "leave_balances"("tenant_id", "year");

-- Overtime
CREATE TABLE "overtime" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "date" DATE NOT NULL,
  "minutes" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "decided_at" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "overtime_employee_id_date_key" ON "overtime"("employee_id", "date");
CREATE INDEX "overtime_tenant_id_status_idx" ON "overtime"("tenant_id", "status");
CREATE INDEX "overtime_tenant_id_date_idx" ON "overtime"("tenant_id", "date");

-- Performance reviews
CREATE TABLE "performance_reviews" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "period" TEXT NOT NULL,
  "reviewer_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ratings" JSONB NOT NULL,
  "overall" DECIMAL(3,1),
  "strengths" TEXT,
  "improvements" TEXT,
  "goals" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "submitted_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "performance_reviews_tenant_employee_period_key" ON "performance_reviews"("tenant_id", "employee_id", "period");
CREATE INDEX "performance_reviews_tenant_id_employee_id_idx" ON "performance_reviews"("tenant_id", "employee_id");
CREATE INDEX "performance_reviews_tenant_id_period_idx" ON "performance_reviews"("tenant_id", "period");
CREATE INDEX "performance_reviews_tenant_id_status_idx" ON "performance_reviews"("tenant_id", "status");

-- Salary advances + deductions
CREATE TABLE "salary_advances" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "amount" DECIMAL(12,2) NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'advance',
  "installments" INTEGER NOT NULL DEFAULT 1,
  "installment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "deducted_so_far" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "requested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "decided_at" TIMESTAMPTZ,
  "decide_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "advance_deductions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "advance_id" TEXT NOT NULL REFERENCES "salary_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "payslip_id" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "deducted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "salary_advances_tenant_id_status_idx" ON "salary_advances"("tenant_id", "status");
CREATE INDEX "salary_advances_tenant_id_employee_id_idx" ON "salary_advances"("tenant_id", "employee_id");
CREATE INDEX "advance_deductions_tenant_id_advance_id_idx" ON "advance_deductions"("tenant_id", "advance_id");
CREATE INDEX "advance_deductions_advance_id_idx" ON "advance_deductions"("advance_id");

-- Onboarding
CREATE TABLE "onboarding_templates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "tasks" JSONB NOT NULL DEFAULT '[]',
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "onboarding_templates_tenant_id_idx" ON "onboarding_templates"("tenant_id");
CREATE TABLE "employee_onboardings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "template_id" TEXT REFERENCES "onboarding_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "items" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'in_progress',
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ
);
CREATE INDEX "employee_onboardings_tenant_id_status_idx" ON "employee_onboardings"("tenant_id", "status");
CREATE INDEX "employee_onboardings_employee_id_idx" ON "employee_onboardings"("employee_id");

-- Exits
CREATE TABLE "employee_exits" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "employee_id" TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "type" TEXT NOT NULL,
  "last_working_day" TIMESTAMPTZ NOT NULL,
  "reason" TEXT,
  "notice_days" INTEGER,
  "clearance_items" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'initiated',
  "initiated_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "initiated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ
);
CREATE INDEX "employee_exits_tenant_id_status_idx" ON "employee_exits"("tenant_id", "status");
CREATE INDEX "employee_exits_tenant_id_employee_id_idx" ON "employee_exits"("tenant_id", "employee_id");

-- HR documents (Document delta)
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "employee_id" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_employee_id_fkey') THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "documents_tenant_id_employee_id_idx" ON "documents"("tenant_id", "employee_id");
