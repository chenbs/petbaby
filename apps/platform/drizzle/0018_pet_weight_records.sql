-- 体重记录。健康分诊的输入质量依赖体重（肥胖判断、疾病趋势都看它），
-- 而 pets 表没有这个字段。
--
-- 三个决定：
-- 1. weight_grams integer 而非 numeric 公斤 —— 浮点公斤会出现 4.1+0.2 != 4.3
--    的显示问题，而克是整数且足够精确（幼猫增重以十克计）。
-- 2. measured_on date 而非 timestamptz —— 体重是「哪一天称的」不是「哪一刻」，
--    与 domain/companion.ts 的「纯日期串按本地零点」同口径，避免差一天。
-- 3. 同一天同一宠物唯一 —— 一天称三次没有趋势意义，重复录入应覆盖而非堆叠。
CREATE TABLE IF NOT EXISTS pet_weight_records (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  weight_grams integer NOT NULL,
  measured_on date NOT NULL,
  note text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pet_weight_pet_measured_idx ON pet_weight_records(pet_id, measured_on DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pet_weight_pet_day_uniq ON pet_weight_records(pet_id, measured_on);
