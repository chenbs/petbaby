ALTER TABLE photos ADD COLUMN IF NOT EXISTS shot_at timestamptz;
CREATE INDEX IF NOT EXISTS photos_pet_shot_idx ON photos(pet_id, shot_at);
