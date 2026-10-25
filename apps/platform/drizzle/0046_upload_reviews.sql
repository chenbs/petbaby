-- 2026-10-26：运营后台「图片审核」。
--
-- 用户上传的四类图片（宠物照片、宠物头像、主人照片、记录附图）进同一个审核队列；
-- 没有审核记录的就是「待审核」。按 storage_key 记录而不是按业务行 id：
-- 换头像时 pets 行不变但对象换了，新头像必须重新进队列。
-- 被移除的图片其业务行已删除，这里留下 status='removed' 的痕迹，配合审计日志追溯。
CREATE TABLE IF NOT EXISTS upload_reviews (
  storage_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('photo','avatar','owner','record')),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('approved','removed')),
  reason text,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS upload_reviews_user_idx ON upload_reviews(user_id);

-- 头像的上传时间：审核队列按时间倒序，pets.created_at 是建档时间，换头像后会排错位置。
ALTER TABLE pets ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
