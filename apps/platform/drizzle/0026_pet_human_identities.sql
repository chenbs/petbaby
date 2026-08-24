CREATE TABLE IF NOT EXISTS pet_human_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  source_photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  prompt_version text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'generating',
  provider text,
  model_version text,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, pet_id, source_photo_id, prompt_version)
);
CREATE INDEX IF NOT EXISTS pet_human_identities_pet_idx ON pet_human_identities(pet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pet_human_identities_user_idx ON pet_human_identities(user_id, created_at DESC);
