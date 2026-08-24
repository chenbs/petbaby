-- 宠物小岛的数据底座（22 号文 5.4）。
--
-- 这是仓库里**第一个留存型模块**。既有七条 live 玩法全部是「单次输入 → 单次输出 → 结束」，
-- 而 14 号文的判据说得很直接：这种形态都在抖音射程内，不能作主付费点。
-- 岛是唯一能把「积累」变成用户每天回来的理由的功能。
--
-- 也正因为是第一个留存型模块，既有六类生成管线的假设（任务入队、产出作品、
-- 可分享、可定价）**一条都不适用**：岛的互动是同步请求-响应，不进 generation_tasks，
-- 产出是状态而不是作品，所以下面六张表与 works / orders 没有任何外键。
--
-- **不为已移出范围的功能预留字段**（22 号文 1.1 / 8.3）：探索地图、钓鱼、寻宝、
-- 等级成长因「不开小游戏号」而移出，这里不留 level、exp、stamina、currency 列。
-- 预留会诱导后续实现直接用上，而那时越线的判断已经没人记得。

-- 一个用户一座岛。
--
-- user_id 上的 UNIQUE 就是「一人一岛」这条产品规则的落点 —— 放在库里而不是
-- 服务层判断，因为建岛接口要幂等（首次进入时端上可能并发发两次），
-- 靠唯一约束 + ON CONFLICT 比靠先查后插可靠。
CREATE TABLE IF NOT EXISTS islands (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  scene_id text NOT NULL DEFAULT 'yard-v1',
  -- 乐观锁（5.6）。摆放提交时比对：两个设备同时摆放，后提交的收到 409
  -- 并重新拉快照，而不是静默覆盖对方的布局。
  version integer NOT NULL DEFAULT 1,
  -- **服务端权威时间**（5.6）。端上时间可改，用它算「今天」会让用户改系统时间刷额度。
  -- 离线事件在下次打开时比较这个值与当前时间来补齐，不需要 Worker 定时跑 ——
  -- 岛没有「必须按时发生」的事（掉线惩罚已被 4.1 #6/#7 禁掉），懒结算完全够用。
  -- 昼夜光照可以用端上时间（纯表现，改了只是看到不同光照，无收益），这条边界不能混。
  last_tick_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

-- 入岛的宠物。
--
-- **memorial 形态不得入岛**（1.4 / 4.1 #11）。这条不在表上做约束而在服务端拦 +
-- 端上过滤，**两处都要**：只做端上隐藏则接口仍可调，只做服务端拦截则用户会看到
-- 入口点进去报错。之所以不做 CHECK，是因为 life_stage 在 pets 表上、且可被用户
-- 随时改成 memorial —— 约束挡不住「入岛之后才改成已离开」这条路径，
-- 那种情况要由读取侧处理（岛内不再显示，而不是删掉记录）。
--
-- 理由：岛的核心机制是「亲密度日增、陪伴天数往上涨」，对已离开的宠物递增天数
-- 是明确的冒犯（CLAUDE.md 已钉死「陪伴天数一律封口」）。纪念形态的对应能力
-- 是纪念空间，不是岛。
CREATE TABLE IF NOT EXISTS island_pets (
  id uuid PRIMARY KEY,
  island_id uuid NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  -- 立绘对象键（透明底 PNG）。为空表示还没生成 —— 此时端上画纯色占位而不是裂图。
  -- 必须透明底才能叠在四档光照 × 四档天气之上（2.6）。
  avatar_key text,
  -- 溯源到 ai_runs。立绘生成**复用 ai_runs 不新开表**：它已有 candidates +
  -- selected_id + cost + provider，正是四选一所需，且后台成本账本已在读那张表。
  -- 不加外键：ai_runs 行可能因成本账本归档而被清理，而立绘键本身仍然有效。
  avatar_run_id uuid,
  -- **只增不减**（4.2）。不显示为进度条（4.1 #5 禁等级/经验条），
  -- 只在里程碑时给一句话。CHECK 钉住非负 —— 任何使其下降的路径都是 bug。
  intimacy integer NOT NULL DEFAULT 0 CHECK (intimacy >= 0),
  joined_at timestamptz NOT NULL,
  UNIQUE(island_id, pet_id)
);
CREATE INDEX IF NOT EXISTS island_pets_island_idx ON island_pets(island_id);

-- 素材库存（采集所得）。
--
-- **不可购买**（1.2 / 4.1 #2）：装扮与道具只能靠积累获得。售卖虚拟物品需要
-- 虚拟支付能力（23 号文的全局改造），而 M1/M2 不做 —— 理由不是「合规不允许」
-- 而是不划算（iOS 抽成 12%、要抬基础库到 2.19.2、结算 30–60 天，而装饰客单价低）。
-- 所以这张表没有 price、没有 currency、没有 purchased_at。
--
-- **静态物品表进代码不进库**：item_id 对应 island/items.ts 的定义（id、名称、
-- 素材键、获取条件），与 plugins/registry.ts 同一模式 —— 物品定义是版本化的
-- 产品内容，不是用户数据。
CREATE TABLE IF NOT EXISTS island_inventory (
  id uuid PRIMARY KEY,
  island_id uuid NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  UNIQUE(island_id, item_id)
);

-- 装饰摆放（M2）。
--
-- 无网格约束：「摆得好看」本身就是留存理由，对齐到格子反而削弱它。
-- flipped 提供水平翻转，所以装饰素材只需一个正面朝向（24 号文第 5 章）。
CREATE TABLE IF NOT EXISTS island_placements (
  id uuid PRIMARY KEY,
  island_id uuid NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  -- 场景坐标系内的位置，整数像素。z 是层级排序键（相对底图地平线）
  x integer NOT NULL,
  y integer NOT NULL,
  z integer NOT NULL DEFAULT 0,
  flipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS island_placements_island_idx ON island_placements(island_id, z);

-- 岛日记 + 离线事件。
--
-- **模板拼装，不用大模型**（4.2）。日记是每天必现的内容，用模型的话每天都有
-- 一次说错话的机会（尤其踩 4.1 #9 健康状态 / #12 诊疗措辞），而模板可被
-- 门禁 15 全量扫描 —— 遍历全部模板 × 全部变量组合，穷举得完。
-- 这是选模板而非模型的主要理由，不是成本。
--
-- template_id 与 payload 分开存而不是存成品文案：模板改了措辞（例如门禁扫出
-- 一个评价词）之后，历史日记应当跟着修正，而存成品会把违规文案永久固化在库里。
CREATE TABLE IF NOT EXISTS island_events (
  id uuid PRIMARY KEY,
  island_id uuid NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  -- 可空且 SET NULL：宠物档案删除后日记仍应读得出（那段陪伴发生过），
  -- 与 hydrateWork 对历史作品的处理同一态度。
  pet_id uuid REFERENCES pets(id) ON DELETE SET NULL,
  -- diary | milestone | offline | on_this_day
  kind text NOT NULL,
  -- 模板 id，便于门禁全量扫描
  template_id text NOT NULL,
  -- 模板变量（天数、照片 id、采集次数 …）
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 归属日。**date 而非 timestamptz**：日记是「哪一天的日记」不是「哪一刻写的」，
  -- 与 pet_weight_records.measured_on 同口径。
  -- 读出来可能是 JS Date，归一必须走 asDateString / asDateKey——
  -- String(value).slice(0,10) 会得到 "Sat Aug 01"（健康线踩过一次）。
  event_date date NOT NULL,
  created_at timestamptz NOT NULL,
  -- 幂等保障（5.6）：连续两次请求不会写出两条同日日记。
  -- 与 health_reminders 的 (pet_id, kind, subject_key) 唯一约束同一手法。
  UNIQUE(island_id, kind, event_date)
);
CREATE INDEX IF NOT EXISTS island_events_island_date_idx ON island_events(island_id, event_date DESC);

-- 每日互动额度。
--
-- **与做图额度、健康额度互不影响**（6.3）：岛的额度用完不该影响做图，反之亦然。
-- 与 health_daily_quotas 独立同源。
--
-- **到上限后的措辞是「今天的草丛都看过了」而不是「体力耗尽」**（4.2）。
-- 措辞差异决定它是不是 4.1 #4 的体力值 —— 后者会把整体推过类目线。
-- 所以这张表叫 daily_actions 而不是 stamina，列名是 gathered 而不是 energy_left：
-- 命名本身就是那条边界的一部分，读代码的人不该在这里看到体力的暗示。
--
-- action_date date + UNIQUE：额度按**服务端时间**判定的日期归档（5.6），
-- 端上传的日期一律不采信。
CREATE TABLE IF NOT EXISTS island_daily_actions (
  id uuid PRIMARY KEY,
  island_id uuid NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  action_date date NOT NULL,
  gathered integer NOT NULL DEFAULT 0 CHECK (gathered >= 0),
  fed integer NOT NULL DEFAULT 0 CHECK (fed >= 0),
  petted integer NOT NULL DEFAULT 0 CHECK (petted >= 0),
  UNIQUE(island_id, action_date)
);
