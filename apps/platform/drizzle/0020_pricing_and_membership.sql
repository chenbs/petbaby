-- C5 定价按积累量分档 + C7 会员重做。

-- 记录定价档位，便于对账。orders.plugin_snapshot 里的 unlockPrice 是**基础价**，
-- 分档后 amount 与它不等，没有这一列对账时算不出为什么这单是 49。
ALTER TABLE orders ADD COLUMN IF NOT EXISTS price_tier text;
ALTER TABLE works ADD COLUMN IF NOT EXISTS accumulation_snapshot jsonb;

-- 月度会员下线。**只置 inactive 不删**：已购月度会员必须履约到期，
-- createMembership 查的是 status='active'，置 inactive 后新用户买不到、老用户不受影响。
UPDATE membership_plan_versions SET status='inactive' WHERE code='monthly' AND status='active';

-- 年度会员改价走**新 version 而非改 amount**：主键是 (code, version)，
-- 历史订单的 entitlement_snapshot 才对得上。
--
-- 权益里去掉 monthlyQuota（D6）：原先卖「每月 10 次生成」，而免费用户
-- 每天 1 次约等于每月 30 次 —— 付费买到的比免费的少，是负向卖点。
-- 新权益跨健康 + 创意两线，单买合计约 138.7，定价 128 用户能自己算清。
INSERT INTO membership_plan_versions (id,code,label,amount,period,entitlements,status,version,created_at)
VALUES ('00000000-0000-4000-8000-000000001303','yearly','年度会员',128,'year',
  '{"tierUnlock":true,"healthExportUnlimited":true,"annualHealthReport":1,"annualReport":1,"physicalDiscount":0.9}',
  'active',2,now())
ON CONFLICT (code,version) DO NOTHING;
UPDATE membership_plan_versions SET status='inactive' WHERE code='yearly' AND version=1;
