CREATE TABLE IF NOT EXISTS share_visits (
  id uuid PRIMARY KEY,
  work_id uuid NOT NULL REFERENCES works(id),
  share_token text NOT NULL,
  event_name text NOT NULL,
  source text,
  visitor_key text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS share_visits_work_created_idx ON share_visits(work_id,created_at DESC);
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE pets ADD COLUMN IF NOT EXISTS life_stage text NOT NULL DEFAULT 'active';
CREATE TABLE IF NOT EXISTS memorial_spaces (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id),
  status text NOT NULL,
  title text NOT NULL,
  story text NOT NULL DEFAULT '',
  theme text NOT NULL DEFAULT 'stardust',
  share_token text UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
