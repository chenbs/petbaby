CREATE TABLE IF NOT EXISTS owner_photos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  storage_key text NOT NULL UNIQUE,
  quality text NOT NULL DEFAULT 'unknown',
  authorization_confirmed_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_photos_user_created_idx ON owner_photos(user_id, created_at);

ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS role_inputs jsonb NOT NULL DEFAULT '{}'::jsonb;
