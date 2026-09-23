-- 独立于私人照片的交付物展示资源；删除照片不撤回已完成作品。
CREATE TABLE IF NOT EXISTS photo_deliverable_assets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  pet_id UUID NOT NULL REFERENCES pets(id),
  photo_id UUID NOT NULL REFERENCES photos(id),
  kind TEXT NOT NULL CHECK (kind IN ('work','interactive','memorial')),
  resource_id UUID NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind,resource_id,photo_id)
);
CREATE INDEX IF NOT EXISTS photo_deliverable_photo_idx ON photo_deliverable_assets(photo_id);
