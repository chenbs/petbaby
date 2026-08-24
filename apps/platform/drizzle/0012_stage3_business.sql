ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS pet_id uuid REFERENCES pets(id);
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS template_code text;
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE annual_reports ADD COLUMN IF NOT EXISTS order_id uuid;
CREATE TABLE IF NOT EXISTS growth_orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  resource_id uuid,
  sku text NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  entitlement_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS growth_orders_user_idx ON growth_orders(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS entitlement_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id uuid REFERENCES memberships(id),
  order_id uuid REFERENCES growth_orders(id),
  kind text NOT NULL,
  units integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS physical_order_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES physical_orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL
);
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
ALTER TABLE physical_orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
CREATE TABLE IF NOT EXISTS physical_skus (
  id uuid PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  amount numeric(10,2) NOT NULL,
  required_asset_kind text,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  UNIQUE(code, version)
);
CREATE TABLE IF NOT EXISTS user_addresses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  ciphertext text NOT NULL,
  masked jsonb NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS annual_report_visits (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES annual_reports(id) ON DELETE CASCADE,
  visitor_key text,
  source text,
  duration_ms integer,
  created_at timestamptz NOT NULL
);
