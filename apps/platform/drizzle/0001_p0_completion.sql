ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS source_work_id uuid;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE works ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE works ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE works SET expires_at = created_at + interval '90 days' WHERE locked=true AND expires_at IS NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason text;
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  amount numeric(10,2) NOT NULL,
  reason text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS refund_dissatisfied_once_idx ON refunds(user_id) WHERE reason='dissatisfied' AND status IN ('pending','succeeded');
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY,
  scope text NOT NULL,
  subject text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  UNIQUE(scope, subject, window_start)
);
CREATE TABLE IF NOT EXISTS system_usage (
  usage_date text PRIMARY KEY,
  generation_count integer NOT NULL DEFAULT 0,
  estimated_cost numeric(10,4) NOT NULL DEFAULT 0,
  circuit_open boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS work_expiry_idx ON works(expires_at) WHERE locked=true;
CREATE INDEX IF NOT EXISTS order_pending_idx ON orders(created_at) WHERE status='pending';
