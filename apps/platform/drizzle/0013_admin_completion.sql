-- Separate administrator suspension from irreversible user deletion.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_suspended_by uuid REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_suspension_reason text;
CREATE INDEX IF NOT EXISTS users_admin_status_idx ON users(admin_suspended_at, deleted_at);

-- Keep the previous live variant so a rollback is a single audited operation.
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS superseded_live_id uuid REFERENCES experiment_variants(id);

-- Persist each subscription delivery attempt for operations and retry diagnosis.
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS admin_closed_at timestamptz;
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS admin_closed_by uuid REFERENCES users(id);
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS admin_closed_reason text;
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS provider_response jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS message_delivery_attempts (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES message_subscriptions(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  status text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}',
  error text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS message_delivery_attempts_subscription_idx ON message_delivery_attempts(subscription_id, created_at DESC);

ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS production_note text;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS refund_reason text;

-- Versioned plans and explicit manual entitlement adjustments.
CREATE TABLE IF NOT EXISTS membership_plan_versions (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  label text NOT NULL,
  amount numeric(10,2) NOT NULL,
  period text NOT NULL,
  entitlements jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  UNIQUE(code, version)
);
INSERT INTO membership_plan_versions (id,code,label,amount,period,entitlements,status,version,created_at)
VALUES
  ('00000000-0000-4000-8000-000000001301','monthly','月度会员',25,'month','{"monthlyQuota":10,"hdReports":true,"hdVideo":1,"physicalDiscount":0.95}','active',1,now()),
  ('00000000-0000-4000-8000-000000001302','yearly','年度会员',199,'year','{"monthlyQuota":10,"hdReports":true,"hdVideo":12,"physicalDiscount":0.9}','active',1,now())
ON CONFLICT (code,version) DO NOTHING;
CREATE TABLE IF NOT EXISTS entitlement_adjustments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  units integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);

-- Versioned annual-report templates and chapters used by the admin catalog.
CREATE TABLE IF NOT EXISTS annual_report_templates (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  label text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL,
  UNIQUE(code, version)
);
INSERT INTO annual_report_templates (id,code,label,config,status,version,is_default,created_at)
VALUES ('00000000-0000-4000-8000-000000001303','wrapped','年度回忆录','{"chapters":["moments","works","interactions"]}','active',1,true,now())
ON CONFLICT (code,version) DO NOTHING;
CREATE TABLE IF NOT EXISTS annual_report_visits (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES annual_reports(id) ON DELETE CASCADE,
  visitor_key text,
  source text,
  event_name text NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL
);
ALTER TABLE annual_report_visits ADD COLUMN IF NOT EXISTS event_name text NOT NULL DEFAULT 'visit';

CREATE INDEX IF NOT EXISTS audit_logs_target_idx ON audit_logs(target_type, target_id, created_at DESC);
