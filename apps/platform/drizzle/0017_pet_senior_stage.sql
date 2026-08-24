-- 生命阶段三态（active / senior / memorial）。
--
-- life_stage 在 0005 只有 `text NOT NULL DEFAULT 'active'`，**没有 CHECK 约束**，
-- 所以新增 'senior' 取值不需要改约束，放宽应用层 Zod 枚举即可。
--
-- 本迁移只补索引：健康线要按生命阶段过滤（memorial 屏蔽全部健康功能），
-- 纪念线可达性也按它判断。
CREATE INDEX IF NOT EXISTS pets_user_life_stage_idx ON pets(user_id, life_stage);
