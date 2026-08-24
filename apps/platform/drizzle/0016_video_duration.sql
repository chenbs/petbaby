-- 成片总时长改为用户可选（10 / 20 / 30 秒）。历史项目按原先的固定口径归到 20 秒。
ALTER TABLE video_projects ADD COLUMN IF NOT EXISTS duration_seconds integer NOT NULL DEFAULT 20;
