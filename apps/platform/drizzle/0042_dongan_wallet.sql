-- 2026-10-08：站内货币「冻干」钱包，会员下线（docs/product/36-冻干钱包与会员下线实施方案.md）。
--
-- 三张表：wallet_accounts 承担行锁与余额缓存；wallet_lots 记每一批入账（来源、单价、有效期）；
-- wallet_ledger 记每一次余额变动，biz_key 唯一保证重复请求不重复扣、不重复到账。

CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  frozen_reason text,
  newcomer_gift_at timestamptz,
  first_topup_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_lots (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pocket text NOT NULL CHECK (pocket IN ('purchased','gift')),
  source text NOT NULL CHECK (source IN ('topup','newcomer_gift','admin_grant')),
  units integer NOT NULL CHECK (units > 0),
  remaining integer NOT NULL CHECK (remaining >= 0),
  unit_price_fen numeric(10,2),
  growth_order_id uuid REFERENCES growth_orders(id),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','refunded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (remaining <= units),
  CHECK (pocket <> 'gift' OR expires_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS wallet_lots_spend_idx ON wallet_lots(user_id, pocket, expires_at, created_at) WHERE status='active' AND remaining > 0;
CREATE INDEX IF NOT EXISTS wallet_lots_expiry_idx ON wallet_lots(expires_at) WHERE status='active' AND expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_lots_topup_idx ON wallet_lots(growth_order_id) WHERE growth_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL CHECK (reason IN ('topup','newcomer_gift','admin_grant','spend','spend_return','expire','topup_refund')),
  biz_key text NOT NULL UNIQUE,
  source_biz_key text,
  ref_type text,
  ref_id text,
  allocations jsonb NOT NULL DEFAULT '[]',
  title text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx ON wallet_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_source_idx ON wallet_ledger(source_biz_key) WHERE source_biz_key IS NOT NULL;

-- 每个付费任务记下它的扣费键：失败退还按这个键原路退，作品是否直接以正式版入库也看它。
-- 为空即历史任务（冻干上线前创建），沿用当时的锁定 / 解锁口径。
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS wallet_biz_key text;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS wallet_biz_key text;
ALTER TABLE art_photo_batches ADD COLUMN IF NOT EXISTS wallet_biz_key text;
ALTER TABLE video_renders ADD COLUMN IF NOT EXISTS wallet_biz_key text;

-- 免费玩法每天 10 次（原来每天 1 次，靠唯一约束限次）。限次改由计数实现，调用方先锁用户行。
ALTER TABLE daily_quotas DROP CONSTRAINT IF EXISTS daily_quotas_user_id_quota_date_key;
CREATE INDEX IF NOT EXISTS daily_quotas_user_date_idx ON daily_quotas(user_id, quota_date);

-- 写真套餐改为 10 / 20 张。历史 24 / 36 张批次只读，约束放宽而不改写存量。
ALTER TABLE art_photo_batches DROP CONSTRAINT IF EXISTS art_photo_batches_package_check;
ALTER TABLE art_photo_batches ADD CONSTRAINT art_photo_batches_package_check CHECK (package IN ('ten','twenty','all'));
ALTER TABLE art_photo_batches DROP CONSTRAINT IF EXISTS art_photo_batches_total_count_check;
ALTER TABLE art_photo_batches ADD CONSTRAINT art_photo_batches_total_count_check CHECK (total_count IN (10,20,24,36));

-- 会员下线：全部套餐归档。表与历史记录保留（entitlement_ledger.membership_id 外键没有 ON DELETE）。
UPDATE membership_plan_versions SET status='archived' WHERE status <> 'archived';
