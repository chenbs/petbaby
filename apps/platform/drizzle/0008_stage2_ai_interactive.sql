ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS pet_id uuid REFERENCES pets(id) ON DELETE CASCADE;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES works(id);
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id);
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_user_idempotency_idx ON ai_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_runs_queue_idx ON ai_runs(status, available_at);
ALTER TABLE ai_provider_circuits ADD COLUMN IF NOT EXISTS manual_open boolean NOT NULL DEFAULT false;

ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS pet_id uuid REFERENCES pets(id) ON DELETE CASCADE;
ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS export_render_id uuid REFERENCES video_renders(id);
ALTER TABLE interactive_sessions ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES works(id);
CREATE INDEX IF NOT EXISTS interactive_share_token_idx ON interactive_sessions(share_token);

ALTER TABLE interactive_events ADD COLUMN IF NOT EXISTS visitor_key text;
ALTER TABLE interactive_events ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE interactive_events ADD COLUMN IF NOT EXISTS duration_ms integer;

ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0;
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES works(id);
CREATE INDEX IF NOT EXISTS video_renders_queue_idx ON video_renders(status, available_at);

ALTER TABLE works ADD COLUMN IF NOT EXISTS asset_kind text NOT NULL DEFAULT 'image';
ALTER TABLE works ADD COLUMN IF NOT EXISTS source_kind text;
ALTER TABLE works ADD COLUMN IF NOT EXISTS source_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS works_source_idx ON works(source_kind, source_id) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;
