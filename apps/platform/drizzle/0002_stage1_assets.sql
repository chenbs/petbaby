ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS quality text NOT NULL DEFAULT 'unknown';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE works ADD COLUMN IF NOT EXISTS preview_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pets_one_default_idx ON pets(user_id) WHERE is_default=true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS photos_pet_position_idx ON photos(user_id, pet_id, position) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS work_versions (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  version integer NOT NULL,
  title text NOT NULL,
  subtitle text NOT NULL,
  output_key text,
  created_at timestamptz NOT NULL,
  UNIQUE(work_id, version)
);
CREATE TABLE IF NOT EXISTS plugin_configs (
  id text PRIMARY KEY,
  manifest jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);
