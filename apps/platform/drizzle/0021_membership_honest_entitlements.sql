-- M2 会员权益诚实化与降价（第二轮改造，路线甲）。
--
-- 迁移 0020 的 v2 ¥128 套餐里有五项权益，其中**三项没有任何兑付代码**：
--   healthExportUnlimited（A5 健康档案 PDF 未实施）
--   annualHealthReport（A6 年度健康报告未实施）
--   annualReport / physicalDiscount（当时只有接口字段，无兑付）
-- 而第五项 tierUnlock 的实现方向是反的（按最高档计价，会员比免费用户多付）。
--
-- 本轮补上了三条兑付链路（M1 tierUnlock 语义、M4 年报权益、M6 实体折扣），
-- A5/A6 仍未实施 —— 所以这一版把那两项**移出权益 JSON**，价格随之下调。
--
-- 路线甲（先降价、A5/A6 完成后再发 ¥128 新版本）而不是「暂时下架会员」：
-- 产品尚未上线，「会员能不能卖」的机会成本接近零，但代码里留着一个
-- 会反向计价的在售套餐是随时会出事的隐患。降价版本同时迫使兑付链路先跑通。
--
-- ¥69 的构成（用户能自己算清）：
--   tierUnlock 每件交付物省 ¥29.1（annual 规格 ¥49 − basic 计价 ¥19.9），做两件即回本
--   annualReport ×1 值 ¥19.9
--   physicalDiscount 9 折
--
-- **改价一律走新 version 不改 amount**：主键是 (code, version)，
-- 已购会员的 memberships.entitlements 与 growth_orders.entitlement_snapshot
-- 是下单当时的快照，改历史行会让对账对不上。已购 v2 的用户按 v2 履约到期。
INSERT INTO membership_plan_versions (id,code,label,amount,period,entitlements,status,version,created_at)
VALUES ('00000000-0000-4000-8000-000000001304','yearly','年度会员',69,'year',
  '{"tierUnlock":true,"annualReport":1,"physicalDiscount":0.9}',
  'active',3,now())
ON CONFLICT (code,version) DO NOTHING;

-- v2 下架。只置 inactive 不删：createMembership 查 status='active'，
-- 置 inactive 后新用户买不到、已购用户不受影响。
UPDATE membership_plan_versions SET status='inactive' WHERE code='yearly' AND version=2;

-- 月度会员在 0020 已置 inactive，这里补一条兜底：
-- 0020 的 WHERE 带了 status='active' 条件，若那次执行时它已是别的状态就会漏掉。
UPDATE membership_plan_versions SET status='inactive' WHERE code='monthly' AND status<>'inactive';

-- 按次权益的核销账本查询要按 (membership_id, kind, status) 过滤（entitlementBalance）。
-- 会员数量级不大，但这条查询在每次年报解锁与余量展示时都会跑。
CREATE INDEX IF NOT EXISTS entitlement_ledger_membership_kind_idx
  ON entitlement_ledger(membership_id, kind, status);

-- E2 去年今日的授权门。授权是**单次消耗品**（微信订阅消息「一次授权一次下发」），
-- 用掉后置 status='consumed'，这一列记下消耗时刻。
--
-- memberships 早就有同名列（0007），message_subscriptions 一直没有 ——
-- 少了它那条 UPDATE 会在运行时报错，而这条路径在 Worker 的批量轮次里跑，
-- 本地不起 Worker 时不会暴露。
ALTER TABLE message_subscriptions ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

-- 授权查询按 (user_id, event_type, status) 过滤，Worker 每小时对全部用户跑一轮。
CREATE INDEX IF NOT EXISTS message_subscriptions_consent_idx
  ON message_subscriptions(user_id, event_type, status);
