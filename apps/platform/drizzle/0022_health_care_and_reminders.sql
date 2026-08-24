-- L5 健康主动提示 + L1/L2 健康交付物的数据底座（第二轮第三批）。
--
-- 20 号文 3.1 的判断：健康线是「日常打开理由」的全部依据，而它 100% 被动 ——
-- `scripts/worker.ts` 的运维轮次无任何健康动作。**合规不产生留存**：
-- 分诊做得再合规，用户也不会每天想起来问一次「我的猫怎么了」。
-- 让健康线成为高频场景的是主动提示，不是分诊本身。
--
-- 而「疫苗驱虫到期」需要一张表来记「上次是什么时候、下次什么时候」——
-- 此前全库没有任何疫苗/驱虫记录（grep 无结果），提示无从产生。

-- 免疫与驱虫记录。
--
-- 三个决定：
-- 1. **只存事实不存结论**：记的是「打了什么、哪天打的、下次哪天」，
--    不记「是否达标」「保护力如何」—— 后者是评价性判断，接近诊断（红线 1）。
--    下次日期由用户或厂商说明决定，产品只负责替他记住。
-- 2. `due_on` 可空：一次性项目（如某些体内驱虫）没有下次；空值表示不提醒。
-- 3. `performed_on date` 而非 timestamptz —— 是「哪一天打的」不是「哪一刻」，
--    与 pet_weight_records 和 domain/companion.ts 的「纯日期按本地零点」同口径。
CREATE TABLE IF NOT EXISTS pet_care_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  -- vaccine / deworm_internal / deworm_external / checkup
  kind text NOT NULL,
  -- 项目名（用户填，例如「猫三联」「体内驱虫」）。不做枚举：疫苗品牌与
  -- 组合太多，枚举必然漏，而漏掉的那种用户就记不了。
  label text NOT NULL,
  performed_on date NOT NULL,
  -- 下次到期日。为空表示不需要提醒。
  due_on date,
  note text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pet_care_pet_due_idx ON pet_care_records(pet_id, due_on);
CREATE INDEX IF NOT EXISTS pet_care_pet_performed_idx ON pet_care_records(pet_id, performed_on DESC);

-- 健康提示的投递记录。
--
-- **独立于 message_subscriptions**：那张表是微信订阅消息通道（一次授权一次下发），
-- 而健康提示走站内通知（user_notifications），两者的授权模型完全不同 ——
-- 混在一张表里会让「有没有推过」和「有没有授权」纠缠在一起。
--
-- 这张表的唯一职责是**去重与限频**：Worker 每 60 秒跑一轮运维动作，
-- 没有它会把同一条「疫苗到期」每分钟推一次。
CREATE TABLE IF NOT EXISTS health_reminders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  -- care_due / weight_change / senior_checkup
  kind text NOT NULL,
  -- 触发这条提示的具体对象（care 记录 id 或体重记录 id）。
  -- 同一个 kind 下不同对象是不同的提示，例如两种疫苗各自到期。
  subject_key text NOT NULL,
  created_at timestamptz NOT NULL,
  -- 同一宠物 + 同一类型 + 同一对象只推一次。
  -- 疫苗明年再到期时 subject_key 会带上新的到期日，所以不会被这条约束挡住。
  UNIQUE(pet_id, kind, subject_key)
);
CREATE INDEX IF NOT EXISTS health_reminders_user_created_idx ON health_reminders(user_id, created_at DESC);

-- L1/L2 健康交付物。
--
-- 与 annual_reports 分开建表而不是加一列 kind：那张表的唯一约束是
-- (user_id, year)，健康档案是「按宠物 + 按导出时刻」而不是「按年」，
-- 一只宠物一年可以导出多份档案（每次就医前都可能导一份）。
--
-- **不进 works**：健康线的产出不是作品 —— 不可分享、不进作品库
-- （见 0019 的说明与 16 号文 3.9）。所以这里也没有 share_token。
CREATE TABLE IF NOT EXISTS health_documents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  -- archive（健康档案 PDF，A5）/ annual（年度健康报告，A6）
  kind text NOT NULL,
  -- annual 才有值；archive 为空
  year integer,
  output_key text NOT NULL,
  -- 生成时的数据快照，便于事后解释「这份档案里的数字是怎么来的」。
  -- 与 generation_tasks.plugin_snapshot 同思路：用户后续改档案不该改变已导出的文件。
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS health_documents_pet_created_idx ON health_documents(pet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS health_documents_user_created_idx ON health_documents(user_id, created_at DESC);
