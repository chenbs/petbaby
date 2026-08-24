ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS story_sections jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS cover_photo_id uuid REFERENCES photos(id);
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active';
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS product_jobs jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE memorial_spaces ADD COLUMN IF NOT EXISTS work_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS memorial_versions (
  id uuid PRIMARY KEY,
  memorial_id uuid NOT NULL REFERENCES memorial_spaces(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(memorial_id, version)
);
CREATE TABLE IF NOT EXISTS memorial_catalog_items (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  UNIQUE(kind, code, version)
);
CREATE TABLE IF NOT EXISTS memorial_visits (
  id uuid PRIMARY KEY,
  memorial_id uuid NOT NULL REFERENCES memorial_spaces(id) ON DELETE CASCADE,
  visitor_key text,
  source text,
  event_name text NOT NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL
);
