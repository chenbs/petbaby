ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS prompt text NOT NULL DEFAULT '';
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'v1';
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS model_version text NOT NULL DEFAULT 'local-v1';
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'local';
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS selected_unlocked boolean NOT NULL DEFAULT false;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS reroll_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ai_cost_ledger (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model_version text NOT NULL,
  units integer NOT NULL DEFAULT 1,
  amount numeric(10,4) NOT NULL DEFAULT 0,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_provider_circuits (
  provider text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  opened_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS interactive_events (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interactive_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS exported_key text;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS exported_key text;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS error_code text;

ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS consented_at timestamptz;
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS address_ciphertext text;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS provider_order_id text;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS print_pdf_key text;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS qc_report jsonb NOT NULL DEFAULT '{}';
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS tracking_no text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS quota_reset_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}';
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS renewal_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS status_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}';
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS preview_key text;
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS template_version text NOT NULL DEFAULT 'wrapped-v1';
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT true;
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS share_token text UNIQUE;
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE TABLE IF NOT EXISTS experiment_metrics (
  id uuid PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  metric text NOT NULL,
  value numeric(12,4) NOT NULL DEFAULT 0,
  sample_count integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
