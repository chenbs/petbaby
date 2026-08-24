CREATE TABLE IF NOT EXISTS video_projects (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  durations jsonb NOT NULL DEFAULT '[]'::jsonb,
  transitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  captions jsonb NOT NULL DEFAULT '[]'::jsonb,
  bgm text NOT NULL DEFAULT 'none',
  cover_photo_id uuid,
  template_code text NOT NULL DEFAULT 'memory-film-v1',
  template_version text NOT NULL DEFAULT '1',
  canvas text NOT NULL DEFAULT 'portrait',
  draft_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_render_id uuid REFERENCES video_renders(id),
  work_id uuid REFERENCES works(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS video_projects_user_idx ON video_projects(user_id, updated_at DESC);
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES video_projects(id);
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS preview_key text;
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS retry_of uuid REFERENCES video_renders(id);
CREATE TABLE IF NOT EXISTS video_catalog_items (
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
CREATE TABLE IF NOT EXISTS operation_audit_logs (
  id uuid PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
