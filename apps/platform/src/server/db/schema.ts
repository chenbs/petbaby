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

export const healthDailyQuotas = pgTable("health_daily_quotas", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  quotaDate: text("quota_date").notNull(),
  kind: text("kind").notNull(),
  used: integer("used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex("health_quota_user_date_kind_idx").on(table.userId, table.quotaDate, table.kind)]);
