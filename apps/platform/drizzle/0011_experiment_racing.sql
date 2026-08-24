ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS variant_code text;
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'all';
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS traffic_source text NOT NULL DEFAULT 'all';
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE experiment_variants ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS experiment_one_live_per_plugin_idx ON experiment_variants(plugin_id) WHERE status='live';
CREATE TABLE IF NOT EXISTS experiment_operations (
  id uuid PRIMARY KEY,
  variant_id uuid NOT NULL REFERENCES experiment_variants(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
ALTER TABLE experiment_metrics ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE experiment_metrics ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'all';
ALTER TABLE experiment_metrics ADD COLUMN IF NOT EXISTS revenue numeric(12,2) NOT NULL DEFAULT 0;
