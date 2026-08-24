ALTER TABLE pets ADD COLUMN IF NOT EXISTS date_type text NOT NULL DEFAULT 'birthday';

ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS plugin_snapshot jsonb;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS unit_price numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS plugin_snapshot jsonb;

ALTER TABLE works ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE works ADD COLUMN IF NOT EXISTS share_access_code_hash text;
ALTER TABLE work_versions ADD COLUMN IF NOT EXISTS preview_key text;

ALTER TABLE events ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS session_key text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS plugin_config_versions (
  id uuid PRIMARY KEY,
  plugin_id text NOT NULL,
  version integer NOT NULL,
  manifest jsonb NOT NULL,
  template_version text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(plugin_id, version)
);

CREATE INDEX IF NOT EXISTS plugin_config_versions_plugin_idx
  ON plugin_config_versions(plugin_id, version DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  target_path text,
  read_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS user_notifications_user_idx
  ON user_notifications(user_id, created_at DESC);

UPDATE orders SET sku = plugin_id || '-single' WHERE sku IS NULL;
UPDATE orders SET unit_price = amount WHERE unit_price IS NULL;
ALTER TABLE orders ALTER COLUMN sku SET NOT NULL;
ALTER TABLE orders ALTER COLUMN unit_price SET NOT NULL;
