-- 日常记录（2026-10）。呕吐、便便、症状、用药、吃喝、就医检查、洗护等「当天发生了什么」。
--
-- 体重与免疫驱虫仍在各自的表（0018 / 0022）：它们有专门的口径（同日覆盖、到期提醒），
-- 日常记录页把三张表合并成一条时间流展示，不搬迁历史数据。
--
-- 三个决定：
-- 1. occurred_on date + occurred_time text 而不是 timestamptz —— 记的是「哪天几点」，
--    与 pet_weight_records、domain/companion.ts 的「纯日期按本地零点」同口径；
--    存 timestamptz 会在东八区凌晨的记录上差一天。
-- 2. details jsonb 按 kind 由服务端 Zod 校验：每类维度不同（呕吐看内容物和次数、便便看形态和颜色），
--    拆成十张表只会让合并时间流变成十路 UNION。
-- 3. **只存用户看到的事实，不存结论**：没有「严重程度评估」「是否异常」字段，
--    用药名由用户填写、产品不给候选（红线 2）。
CREATE TABLE IF NOT EXISTS pet_daily_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  -- vomit / stool / symptom / medication / meal / water / visit / grooming / other
  kind text NOT NULL,
  occurred_on date NOT NULL,
  -- HH:mm，可空（只记得哪天、不记得几点）
  occurred_time text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  -- 从健康助手结果「记到日常记录」时关联的分诊记录，便于回看当时的建议
  health_session_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pet_daily_logs_pet_day_idx ON pet_daily_logs(pet_id, occurred_on DESC, occurred_time DESC);
CREATE INDEX IF NOT EXISTS pet_daily_logs_pet_kind_idx ON pet_daily_logs(pet_id, kind, occurred_on DESC);

-- 记录附图（呕吐物、便便、皮肤、处方单）。
--
-- **不进照片库 photos**：照片库是陪伴素材，会进入时间线、年度短片与创作选图；
-- 一张呕吐物照片出现在年度短片里是不可接受的。所以独立私有存储
-- （private/<userId>/records/），只有本人可读、no-store。
--
-- log_id 可空：先上传、后提交记录。超过一天仍未关联的附件由维护任务登记清理。
CREATE TABLE IF NOT EXISTS pet_record_attachments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  log_id uuid REFERENCES pet_daily_logs(id) ON DELETE SET NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pet_record_attachments_log_idx ON pet_record_attachments(log_id);
CREATE INDEX IF NOT EXISTS pet_record_attachments_orphan_idx ON pet_record_attachments(created_at) WHERE log_id IS NULL;
