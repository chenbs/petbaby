-- 2026-10-12：渠道归因与邀请奖励（不投流期的增长口径）。
--
-- 渠道归因只在「新建账号」那一次写入，之后不再覆盖：
--   acquisition_channel 按微信场景值归类（share / qrcode / search / channels …），被邀请的新用户记为 invite；
--   acquisition_src     运营投放标记（小程序路径或码上的 src=xxx，例如 xhs-1012-human），没有就为空；
--   acquisition_scene   原始场景值，归类表改了也能回溯。
-- invited_by 是邀请人。邀请码 invite_code 按需生成，8 位去掉易混字符。
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_channel text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_src text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition_scene integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code text;
CREATE UNIQUE INDEX IF NOT EXISTS users_invite_code_key ON users (invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_acquisition_idx ON users (created_at, acquisition_channel);

-- 邀请奖励：被邀请人建好第一只宠物后结算一次。
-- invitee_key 是被邀请人 unionid 的哈希：注销会清空 unionid，同一个微信重新注册不能再给邀请人结算一次。
-- reward_date 是北京时间日期，邀请人每天最多拿 5 颗；超出的照样登记为 capped（units=0），不补发。
CREATE TABLE IF NOT EXISTS invite_rewards (
  id uuid PRIMARY KEY,
  inviter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  invitee_key text NOT NULL UNIQUE,
  reward_date date NOT NULL,
  units integer NOT NULL CHECK (units >= 0),
  status text NOT NULL CHECK (status IN ('granted','capped')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invite_rewards_inviter_day_idx ON invite_rewards (inviter_id, reward_date);

-- 钱包新增入账来源「邀请奖励」（赠送所得，带有效期）。
ALTER TABLE wallet_lots DROP CONSTRAINT IF EXISTS wallet_lots_source_check;
ALTER TABLE wallet_lots ADD CONSTRAINT wallet_lots_source_check CHECK (source IN ('topup','newcomer_gift','admin_grant','invite_reward'));
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_reason_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_reason_check CHECK (reason IN ('topup','newcomer_gift','admin_grant','invite_reward','spend','spend_return','expire','topup_refund'));
