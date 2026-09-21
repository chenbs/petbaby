import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDatabase, databaseContext, type Database } from "./connection";
import { migrateDatabase } from "./migrate";
export type { Database, SqlRow } from "./connection";

declare global {
  var __petbabyDatabasePromise: Promise<Database> | undefined;
  var __petbabyDatabaseReady: Promise<void> | undefined;
}

export async function getDatabase(): Promise<Database> {
  const transaction = databaseContext.getStore();
  if (transaction) return transaction;
  globalThis.__petbabyDatabasePromise ??= createDatabase();
  const database = await globalThis.__petbabyDatabasePromise;
  globalThis.__petbabyDatabaseReady ??= migrateDatabase(database);
  await globalThis.__petbabyDatabaseReady;
  return database;
}

export async function inTransaction<T>(operation: (database: Database) => Promise<T>): Promise<T> {
  const database = await getDatabase();
  return database.transaction(operation);
}

export async function resetDatabaseForTest() {
  const database = await getDatabase();
  await database.exec("TRUNCATE payment_refund_inquiries, payment_refunds, payment_transactions, wechat_sessions, user_notifications, pet_human_identities, owner_photos, plugin_config_versions, plugin_configs, refunds, rate_limits, system_usage, ai_cost_ledger, interactive_events, experiment_metrics, events, daily_quotas, health_daily_quotas, health_sessions, health_reminders, health_documents, pet_care_records, pet_weight_records, audit_logs, operation_audit_logs, orders, growth_orders, physical_orders, generation_tasks, works, photos, pets, users CASCADE;");
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
}
