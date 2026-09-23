-- 正常照片长期作为记录保留；请求键随软删墓碑保留。
ALTER TABLE photos ADD COLUMN IF NOT EXISTS memory_date date;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS caption text NOT NULL DEFAULT '';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS metadata_version integer NOT NULL DEFAULT 1;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS metadata_updated_at timestamptz;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS upload_request_id uuid;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS content_sha256 text;
CREATE UNIQUE INDEX IF NOT EXISTS photos_upload_request_idx ON photos(user_id, upload_request_id);
CREATE INDEX IF NOT EXISTS photos_uploaded_idx ON photos(user_id, pet_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS photos_recorded_idx ON photos(user_id, pet_id, memory_date, shot_at, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS photos_library_idx ON photos(user_id, pet_id, position, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS photos_content_idx ON photos(user_id, pet_id, content_sha256) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS object_cleanup_jobs (
  id uuid PRIMARY KEY,
  storage_key text NOT NULL UNIQUE,
  reason text NOT NULL,
  photo_id uuid REFERENCES photos(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','protected')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS object_cleanup_due_idx ON object_cleanup_jobs(status, next_attempt_at);
