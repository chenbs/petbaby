-- P5 恢复 ¥128 会员（第二轮第三批收尾）。
--
-- 迁移 0021 把年费降到 ¥69 并移出两项健康权益，理由是 A5/A6 未实施 ——
-- **卖一项没有兑付代码的权益就是收钱不给东西**。
--
-- 本批已实施：
--   A5 健康档案 PDF  → server/health/document.ts + createHealthDocument（archive）
--   A6 年度健康记录  → 同一函数传 year（annual），走 annualHealthReport 按次权益
-- 兑付链路有 18 条用例覆盖（server/health/document.test.ts），
-- 含「无权益拒绝导出」「会员无限导出」「按次权益用完回落」「memorial 拒绝」。
--
-- 所以现在可以把这两项加回权益 JSON 并恢复原定价。
--
-- 20 号文 6.2 判断二的定价依据（用户能自己算清）：
--   tierUnlock       每件交付物省 ¥29.1（annual 规格 ¥49 − basic 计价 ¥19.9）
--   healthExportUnlimited  单买 ¥29.9/次，无限导出
--   annualHealthReport ×1  单买 ¥39.9
--   annualReport ×1        单买 ¥19.9
--   physicalDiscount       实体 9 折
-- 一次性权益合计已 ¥89.7，加一件交付物的档差即超过 ¥118，两件即明显划算。
--
-- **仍然走新 version 不改 amount**：主键是 (code, version)，
-- 已购 v3 ¥69 的用户按 v3 的权益快照履约到期 —— 他们付的是 ¥69，
-- 拿到的是当时承诺的三项，这没有问题；改历史行会让对账对不上。
INSERT INTO membership_plan_versions (id,code,label,amount,period,entitlements,status,version,created_at)
VALUES ('00000000-0000-4000-8000-000000001305','yearly','年度会员',128,'year',
  '{"tierUnlock":true,"healthExportUnlimited":true,"annualHealthReport":1,"annualReport":1,"physicalDiscount":0.9}',
  'active',4,now())
ON CONFLICT (code,version) DO NOTHING;

-- v3 下架。只置 inactive 不删：已购用户必须履约到期。
UPDATE membership_plan_versions SET status='inactive' WHERE code='yearly' AND version=3;
