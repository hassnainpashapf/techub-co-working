-- Phase 48: Smart Access & Entry Pack

CREATE TABLE doors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  device_id TEXT,
  type TEXT NOT NULL DEFAULT 'internal',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX doors_tenant_active_idx ON doors (tenant_id, is_active);
CREATE INDEX doors_tenant_type_idx ON doors (tenant_id, type);

CREATE TABLE access_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, member_id, type, value_hash)
);
CREATE INDEX access_credentials_tenant_member_idx ON access_credentials (tenant_id, member_id);

CREATE TABLE access_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  door_id TEXT NOT NULL REFERENCES doors(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  credential_type TEXT,
  direction TEXT NOT NULL,
  result TEXT NOT NULL,
  reason TEXT,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX access_logs_tenant_door_idx ON access_logs (tenant_id, door_id, created_at);
CREATE INDEX access_logs_tenant_member_idx ON access_logs (tenant_id, member_id, created_at);
CREATE INDEX access_logs_tenant_result_idx ON access_logs (tenant_id, result, created_at);

CREATE TABLE access_schedules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  door_id TEXT REFERENCES doors(id) ON DELETE CASCADE,
  days_of_week JSONB NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX access_schedules_tenant_member_idx ON access_schedules (tenant_id, member_id);
CREATE INDEX access_schedules_tenant_door_idx ON access_schedules (tenant_id, door_id);

CREATE TABLE day_passes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visitor_name TEXT NOT NULL,
  visitor_phone TEXT,
  host_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  door_ids JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  used_at TIMESTAMPTZ,
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX day_passes_tenant_status_idx ON day_passes (tenant_id, status);
CREATE INDEX day_passes_tenant_until_idx ON day_passes (tenant_id, valid_until);
