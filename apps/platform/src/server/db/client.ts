import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDatabase, databaseContext, type Database } from "./connection";
import { listMigrationNames, migrateDatabase } from "./migrate";
export type { Database, SqlRow } from "./connection";

declare global {
  var __petbabyDatabasePromise: Promise<Database> | undefined;
  var __petbabyDatabaseReady: Promise<void> | undefined;
  var __petbabyRollbackEffects: AsyncLocalStorage<Array<() => Promise<void>>> | undefined;
  var __petbabyMigrationNames: string | undefined;
  var __petbabyMigrationCheckedAt: number | undefined;
}

export async function getDatabase(): Promise<Database> {
  const transaction = databaseContext.getStore();
  if (transaction) return transaction;
  globalThis.__petbabyDatabasePromise ??= createDatabase();
  const database = await globalThis.__petbabyDatabasePromise;
  globalThis.__petbabyDatabaseReady ??= migrateDatabase(database);
  await globalThis.__petbabyDatabaseReady;
  if (process.env.NODE_ENV === "development") await migrateWhenAdded(database);
  return database;
}

/*
 * 开发态补跑新增迁移（2026-10）。
 *
 * 迁移只在进程首次访问数据库时跑一次（结果挂在 globalThis 上，热重载不会重跑）。
 * 于是 `pnpm dev` 开着时拉代码或合并分支带进来的新迁移不会执行，
 * 症状是新接口一律 500「服务暂时不可用」，而老接口一切正常——日常记录上线时就这样踩过。
 * 开发态每 2 秒最多看一次 drizzle/ 目录，文件清单变了就再跑一遍（已登记的迁移会跳过）。
 * 生产与测试不走这里：生产由发布脚本先迁移再起服务，测试由 resetDatabaseForTest 控制。
 */
async function migrateWhenAdded(database: Database) {
  const now = Date.now();
  if (now - (globalThis.__petbabyMigrationCheckedAt ?? 0) < 2_000) return;
  globalThis.__petbabyMigrationCheckedAt = now;
  const names = (await listMigrationNames()).join(",");
  if (names === globalThis.__petbabyMigrationNames) return;
  globalThis.__petbabyDatabaseReady = migrateDatabase(database);
  await globalThis.__petbabyDatabaseReady;
  globalThis.__petbabyMigrationNames = names;
}

const rollbackEffects = globalThis.__petbabyRollbackEffects ??= new AsyncLocalStorage<Array<() => Promise<void>>>();

/** Register external writes before attempting them; compensation runs after rollback. */
export function afterTransactionRollback(effect: () => Promise<void>) {
  const effects = rollbackEffects.getStore();
  if (!effects) throw new Error("TRANSACTION_REQUIRED");
  effects.push(effect);
}

export async function inTransaction<T>(operation: (database: Database) => Promise<T>): Promise<T> {
  const database = await getDatabase();
  if (rollbackEffects.getStore()) return database.transaction(operation);
  const effects: Array<() => Promise<void>> = [];
  try { return await rollbackEffects.run(effects, () => database.transaction(operation)); }
  catch (error) {
    for (const effect of effects.reverse()) await effect();
    throw error;
  }
}

export async function resetDatabaseForTest() {
  const database = await getDatabase();
  await database.exec("TRUNCATE wallet_ledger, wallet_lots, wallet_accounts, home_curation, ai_original_deliveries, ai_disclosure_acknowledgements, object_cleanup_jobs, payment_refund_inquiries, payment_refunds, payment_transactions, wechat_sessions, user_notifications, pet_human_identities, owner_photos, plugin_config_versions, plugin_configs, refunds, rate_limits, system_usage, ai_cost_ledger, interactive_events, experiment_metrics, events, daily_quotas, health_daily_quotas, health_sessions, health_reminders, health_documents, pet_record_attachments, pet_daily_logs, pet_care_records, pet_weight_records, audit_logs, operation_audit_logs, orders, growth_orders, physical_orders, generation_tasks, works, photos, pets, users CASCADE;");
  await database.exec("INSERT INTO ai_provider_slots (slot_id) SELECT generate_series(1,8) ON CONFLICT DO NOTHING;");
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0013_admin_completion.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0014_password_auth.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0015_photo_shot_at.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0016_video_duration.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0017_pet_senior_stage.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0018_pet_weight_records.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0019_health_advisory.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0020_pricing_and_membership.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0021_membership_honest_entitlements.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0022_health_care_and_reminders.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0023_membership_health_entitlements.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0025_owner_photos_and_ai_roles.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0026_pet_human_identities.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0027_remove_retired_feature.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0028_payment_transactions.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0029_entitlement_delivery_reference.sql"), "utf8"));
  // 0013/0020/0021/0023 会重新灌入会员套餐种子；最后重放 0042 把它们归档，否则测试库里年卡会「复活」。
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0042_dongan_wallet.sql"), "utf8"));
}
