-- 《人工智能生成合成内容标识办法》第九条：向用户提供不含显式标识的生成合成内容前，
-- 需通过用户协议明确用户的标识义务和使用责任，并留存提供对象等日志不少于六个月。
--
-- 2026-09 起保存到相册的原图上没有可见标识（只有文件元数据），所以用户第一次保存
-- 生成类原图前要确认一次；确认记录与每次交付记录都落在这里，不参与任何自动清理。
CREATE TABLE IF NOT EXISTS ai_disclosure_acknowledgements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  channel text NOT NULL DEFAULT 'miniprogram',
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, policy_version)
);

-- 交付日志：谁、在什么时候、拿到了哪一份不含显式标识的生成内容。
-- 不设外键到 works：作品被用户删除后，交付记录仍需按法定期限保留。
CREATE TABLE IF NOT EXISTS ai_original_deliveries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('work','ai_candidate','art_photo_item')),
  resource_id text NOT NULL,
  storage_key text NOT NULL,
  policy_version text NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_original_deliveries_user_idx ON ai_original_deliveries(user_id, delivered_at DESC);
