CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  wechat_openid text UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS pets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  species text NOT NULL,
  gender text NOT NULL,
  birthday text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size integer NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS works (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES photos(id),
  title text NOT NULL,
  subtitle text NOT NULL,
  serial_number text NOT NULL,
  authority text NOT NULL,
  output_key text,
  locked boolean NOT NULL DEFAULT true,
  public boolean NOT NULL DEFAULT false,
  share_token text UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS generation_tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  photo_ids jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL,
  attempt integer NOT NULL,
  work_id uuid,
  error_code text,
  available_at timestamptz NOT NULL,
  locked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS task_claim_idx ON generation_tasks(status, available_at);
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id),
  plugin_id text NOT NULL,
  amount numeric(10,2) NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  UNIQUE(user_id, work_id)
);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id text,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS event_created_idx ON events(created_at);
CREATE TABLE IF NOT EXISTS daily_quotas (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date text NOT NULL,
  task_id uuid,
  created_at timestamptz NOT NULL,
  UNIQUE(user_id, quota_date)
);
