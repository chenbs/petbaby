import {
  boolean,
  date,
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  wechatOpenid: text("wechat_openid").unique(),
  accountName: text("account_name"),
  passwordHash: text("password_hash"),
  passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const pets = pgTable("pets", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  species: text("species").notNull(),
  gender: text("gender").notNull(),
  birthday: text("birthday"),
  dateType: text("date_type").notNull().default("birthday"),
  lifeStage: text("life_stage").notNull().default("active"),
  avatarKey: text("avatar_key"),
  isDefault: boolean("is_default").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const photos = pgTable("photos", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  position: integer("position").notNull().default(0),
  quality: text("quality").notNull().default("unknown"),
  /** EXIF 拍摄时间。可空：历史照片与截图没有 EXIF，读取侧回落到 created_at */
  shotAt: timestamp("shot_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("photos_pet_shot_idx").on(table.petId, table.shotAt)]);

export const generationTasks = pgTable("generation_tasks", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  photoIds: jsonb("photo_ids").$type<string[]>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  progress: integer("progress").notNull(),
  attempt: integer("attempt").notNull(),
  workId: uuid("work_id"),
  errorCode: text("error_code"),
  sourceWorkId: uuid("source_work_id"),
  pluginSnapshot: jsonb("plugin_snapshot").$type<Record<string, unknown>>(),
  options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("generation_user_idempotency_idx").on(table.userId, table.idempotencyKey)]);

export const works = pgTable("works", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  photoId: uuid("photo_id").notNull().references(() => photos.id),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  serialNumber: text("serial_number").notNull(),
  authority: text("authority").notNull(),
  outputKey: text("output_key"),
  previewKey: text("preview_key"),
  locked: boolean("locked").notNull(),
  public: boolean("public").notNull(),
  shareToken: text("share_token").unique(),
  shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
  shareAccessCodeHash: text("share_access_code_hash"),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const ownerPhotos = pgTable("owner_photos", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  quality: text("quality").notNull().default("unknown"),
  authorizationConfirmedAt: timestamp("authorization_confirmed_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const petHumanIdentities = pgTable("pet_human_identities", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  sourcePhotoId: uuid("source_photo_id").notNull().references(() => photos.id, { onDelete: "cascade" }),
  promptVersion: text("prompt_version").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  status: text("status").notNull().default("generating"),
  provider: text("provider"),
  modelVersion: text("model_version"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("pet_human_identities_cache_uniq").on(table.userId, table.petId, table.sourcePhotoId, table.promptVersion),
  index("pet_human_identities_pet_idx").on(table.petId, table.createdAt),
  index("pet_human_identities_user_idx").on(table.userId, table.createdAt),
]);

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id").notNull(),
  petId: uuid("pet_id").references(() => pets.id, { onDelete: "cascade" }),
  photoIds: jsonb("photo_ids").$type<string[]>().notNull().default([]),
  roleInputs: jsonb("role_inputs").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull(),
  candidates: jsonb("candidates").notNull().default([]),
  selectedId: text("selected_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id").notNull().references(() => works.id),
  pluginId: text("plugin_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  refundedAmount: numeric("refunded_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  refundReason: text("refund_reason"),
  sku: text("sku").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  entitlements: jsonb("entitlements").$type<Record<string, unknown>>().notNull().default({}),
  pluginSnapshot: jsonb("plugin_snapshot").$type<Record<string, unknown>>(),
}, (table) => [uniqueIndex("order_user_work_idx").on(table.userId, table.workId)]);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const rateLimits = pgTable("rate_limits", {
  id: uuid("id").primaryKey(),
  scope: text("scope").notNull(),
  subject: text("subject").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull().default(1),
}, (table) => [uniqueIndex("rate_limit_scope_subject_window_idx").on(table.scope, table.subject, table.windowStart)]);

export const systemUsage = pgTable("system_usage", {
  usageDate: text("usage_date").primaryKey(),
  generationCount: integer("generation_count").notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 4 }).notNull().default("0"),
  circuitOpen: boolean("circuit_open").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const dailyQuotas = pgTable("daily_quotas", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quotaDate: text("quota_date").notNull(),
  taskId: uuid("task_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("quota_user_date_idx").on(table.userId, table.quotaDate)]);

export const petWeightRecords = pgTable("pet_weight_records", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  // 克而非公斤：浮点公斤会出现 4.1+0.2 != 4.3 的显示问题。
  weightGrams: integer("weight_grams").notNull(),
  // date 而非 timestamptz：体重是「哪一天称的」，不是「哪一刻」。
  measuredOn: date("measured_on").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("pet_weight_pet_measured_idx").on(table.petId, table.measuredOn),
  uniqueIndex("pet_weight_pet_day_uniq").on(table.petId, table.measuredOn),
]);

export const healthSessions = pgTable("health_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  photoIds: jsonb("photo_ids").notNull(),
  petSnapshot: jsonb("pet_snapshot").notNull(),
  triageLevel: text("triage_level").notNull(),
  // keyword / model —— 审计要求，必须能区分规则直通与模型判定。
  triageSource: text("triage_source").notNull(),
  advisory: jsonb("advisory").notNull(),
  modelSnapshot: jsonb("model_snapshot"),
  status: text("status").notNull().default("succeeded"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("health_sessions_pet_created_idx").on(table.petId, table.createdAt),
  index("health_sessions_user_created_idx").on(table.userId, table.createdAt),
]);

/*
 * 宠物小岛（迁移 0024）。仓库里第一个留存型模块 —— 互动是同步请求-响应，
 * 不进 generation_tasks，产出是状态而不是作品，所以这六张表与 works / orders 无关联。
 *
 * **不为已移出范围的功能预留字段**（22 号文 8.3）：探索地图、钓鱼、等级成长因
 * 「不开小游戏号」而移出，这里没有 level / exp / stamina / currency 列。
 * 预留会诱导后续实现直接用上，而那时越线的判断已经没人记得。
 */
export const islands = pgTable("islands", {
  id: uuid("id").primaryKey(),
  // 一人一岛。UNIQUE 让建岛接口能靠 ON CONFLICT 幂等，而不是先查后插
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  sceneId: text("scene_id").notNull().default("yard-v1"),
  // 乐观锁：两个设备同时摆放时后提交的收到 409，不静默覆盖
  version: integer("version").notNull().default(1),
  // 服务端权威时间。额度与「今天」一律按它算 —— 端上时间可改
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const islandPets = pgTable("island_pets", {
  id: uuid("id").primaryKey(),
  islandId: uuid("island_id").notNull().references(() => islands.id, { onDelete: "cascade" }),
  petId: uuid("pet_id").notNull().references(() => pets.id, { onDelete: "cascade" }),
  // 透明底 PNG 的对象键。为空表示未生成，端上画占位而不是裂图
  avatarKey: text("avatar_key"),
  // 溯源到 ai_runs（复用而不新开表：那边已有 candidates/selected_id/cost/provider）。
  // 不加外键 —— 成本账本归档可能清掉 ai_runs 行，而立绘键仍然有效
  avatarRunId: uuid("avatar_run_id"),
  // 只增不减（22 号文 4.2）。不显示为进度条：等级/经验条是 4.1 #5 的禁止项
  intimacy: integer("intimacy").notNull().default(0),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("island_pets_island_pet_uniq").on(table.islandId, table.petId),
  index("island_pets_island_idx").on(table.islandId),
]);

// 采集所得，**不可购买**（22 号文 1.2 / 4.1 #2）：所以没有 price / currency 列。
// item_id 对应 island/items.ts，静态物品表进代码不进库（同 plugins/registry.ts）
export const islandInventory = pgTable("island_inventory", {
  id: uuid("id").primaryKey(),
  islandId: uuid("island_id").notNull().references(() => islands.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [uniqueIndex("island_inventory_island_item_uniq").on(table.islandId, table.itemId)]);

export const islandPlacements = pgTable("island_placements", {
  id: uuid("id").primaryKey(),
  islandId: uuid("island_id").notNull().references(() => islands.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  z: integer("z").notNull().default(0),
  // 水平翻转，所以装饰素材只需一个正面朝向
  flipped: boolean("flipped").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [index("island_placements_island_idx").on(table.islandId, table.z)]);

// 日记：**模板拼装不用大模型**（22 号文 4.2）。存 template_id + payload 而非成品文案 ——
// 模板改措辞后历史日记应跟着修正，存成品会把违规文案永久固化在库里
export const islandEvents = pgTable("island_events", {
  id: uuid("id").primaryKey(),
  islandId: uuid("island_id").notNull().references(() => islands.id, { onDelete: "cascade" }),
  // SET NULL：档案删除后日记仍读得出，那段陪伴发生过
  petId: uuid("pet_id").references(() => pets.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  templateId: text("template_id").notNull(),
  payload: jsonb("payload").notNull().default({}),
  // date 而非 timestamptz：是「哪一天的日记」不是「哪一刻写的」
  eventDate: date("event_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  // 幂等：连续两次结算不产生第二条同日日记（同 health_reminders 的手法）
  uniqueIndex("island_events_island_kind_date_uniq").on(table.islandId, table.kind, table.eventDate),
  index("island_events_island_date_idx").on(table.islandId, table.eventDate),
]);

/*
 * 每日互动额度，与做图额度、健康额度互不影响（22 号文 6.3）。
 *
 * 表名是 daily_actions 而不是 stamina，列名是 gathered 而不是 energy_left：
 * 到上限后的措辞必须是「今天的草丛都看过了」而不是「体力耗尽」，否则它就成了
 * 4.1 #4 的体力值 —— 那会把整体推过类目线。命名本身是那条边界的一部分。
 */
export const islandDailyActions = pgTable("island_daily_actions", {
  id: uuid("id").primaryKey(),
  islandId: uuid("island_id").notNull().references(() => islands.id, { onDelete: "cascade" }),
  // 按服务端时间判定的日期，端上传的一律不采信
  actionDate: date("action_date").notNull(),
  gathered: integer("gathered").notNull().default(0),
  fed: integer("fed").notNull().default(0),
  petted: integer("petted").notNull().default(0),
}, (table) => [uniqueIndex("island_daily_actions_island_date_uniq").on(table.islandId, table.actionDate)]);

export const healthDailyQuotas = pgTable("health_daily_quotas", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quotaDate: text("quota_date").notNull(),
  kind: text("kind").notNull(),
  used: integer("used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("health_quota_user_date_kind_idx").on(table.userId, table.quotaDate, table.kind)]);
