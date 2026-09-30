CREATE TABLE IF NOT EXISTS art_photo_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE RESTRICT,
  package text NOT NULL CHECK (package IN ('ten','all')),
  total_count integer NOT NULL CHECK (total_count IN (10,24)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','processing','completed','partial','failed','cancelled')),
  order_id uuid,
  request_key text,
  completed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS art_photo_batches_user_idx ON art_photo_batches(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS art_photo_batches_request_idx ON art_photo_batches(user_id,request_key) WHERE request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS art_photo_batch_items (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES art_photo_batches(id) ON DELETE CASCADE,
  scene_id text NOT NULL,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','succeeded','failed','cancelled')),
  run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
  output_key text,
  preview_key text,
  error_code text,
  attempt integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, scene_id),
  UNIQUE(batch_id, position)
);
CREATE INDEX IF NOT EXISTS art_photo_batch_items_queue_idx ON art_photo_batch_items(status, updated_at);

CREATE TABLE IF NOT EXISTS ai_provider_slots (
  slot_id integer PRIMARY KEY CHECK (slot_id BETWEEN 1 AND 8),
  run_id uuid UNIQUE REFERENCES ai_runs(id) ON DELETE SET NULL,
  attempt integer,
  lease_until timestamptz
);
INSERT INTO ai_provider_slots (slot_id) SELECT generate_series(1,8) ON CONFLICT DO NOTHING;
