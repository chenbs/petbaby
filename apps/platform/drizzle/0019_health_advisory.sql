-- 健康分诊（A1/A2/A3）。定位是**分诊不是诊断** —— 见 16 号文第三章的合规边界。
--
-- 独立建表而不复用 generation_tasks/works：健康线的产出不是作品，
-- 不进作品库、不可分享、不产生 works 行。复用会污染现有 10 个玩法的模型。
CREATE TABLE IF NOT EXISTS health_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  description text NOT NULL,
  photo_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- 快照品种/年龄/体重/生命阶段：用户后续改档案不应改变历史记录的输入前提，
  -- 与 generation_tasks.plugin_snapshot 同思路。
  pet_snapshot jsonb NOT NULL,
  -- emergency / urgent_24h / observe / routine 四档
  triage_level text NOT NULL,
  -- keyword / model。**这个字段是审计要求**：紧急症状走关键词直通，
  -- 必须能事后区分「AI 判的」与「规则判的」，争议追溯时是关键证据。
  triage_source text NOT NULL,
  -- 结构化结论（四档 + 升级条件 + 就医准备 + 可能相关方向 + 免责声明）。
  -- 存 jsonb 而非 text：端上要分别渲染免责声明与结论，文本做不到。
  advisory jsonb NOT NULL,
  model_snapshot jsonb,
  -- 模型调用会失败，失败也要落库 —— 否则用户看到空白且无法追溯。
  -- 与 generation_tasks 的失败落库口径一致。
  status text NOT NULL DEFAULT 'succeeded',
  error_code text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS health_sessions_pet_created_idx ON health_sessions(pet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS health_sessions_user_created_idx ON health_sessions(user_id, created_at DESC);

-- 健康额度独立于创意生成的 daily_quotas：健康分诊用完不该影响做图额度，
-- 那是两种资源。不在 daily_quotas 上加 kind 列是因为它的唯一约束是
-- (user_id, quota_date)，加列要改历史迁移的约束，属反模式。
CREATE TABLE IF NOT EXISTS health_daily_quotas (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date text NOT NULL,
  kind text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  UNIQUE(user_id, quota_date, kind)
);
