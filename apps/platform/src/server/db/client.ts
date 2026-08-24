import "server-only";

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";

export type SqlRow = Record<string, unknown>;

export interface Database {
  query<T extends SqlRow>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

async function createDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL || "file://.data/petbaby";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
    return {
      async query<T extends SqlRow>(sql: string, params: unknown[] = []) {
        return [...await client.unsafe(sql, params as never[])] as unknown as T[];
      },
      async exec(sql) { await client.unsafe(sql); },
      async close() { await client.end(); },
    };
  }

  if (url === "memory://") {
    const client = new PGlite();
    return {
      async query<T extends SqlRow>(sql: string, params: unknown[] = []) { return (await client.query<T>(sql, params)).rows; },
      async exec(sql: string) { await client.exec(sql); },
      async close() { await client.close(); },
    };
  }
  if (url.startsWith("file://")) {
    await mkdir(path.resolve(url.slice("file://".length)), { recursive: true });
  }
  const client = new PGlite(url);
  return {
    async query<T extends SqlRow>(sql: string, params: unknown[] = []) {
      const result = await client.query<T>(sql, params);
      return result.rows;
    },
    async exec(sql) { await client.exec(sql); },
    async close() { await client.close(); },
  };
}

declare global {
  var __petbabyDatabasePromise: Promise<Database> | undefined;
  var __petbabyDatabaseMigrated: boolean | undefined;
}

export async function getDatabase() {
  globalThis.__petbabyDatabasePromise ??= createDatabase();
  const database = await globalThis.__petbabyDatabasePromise;
  if (!globalThis.__petbabyDatabaseMigrated) {
    const migrations = await Promise.all([
      readFile(path.join(process.cwd(), "drizzle", "0000_initial.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0001_p0_completion.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0002_stage1_assets.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0003_growth_features.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0004_account_and_admin.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0005_attribution_and_lifecycle.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0006_stage1_completion.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0007_stage2_platform.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0008_stage2_ai_interactive.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0009_video_memorial_operations.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0010_memorial_products.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0011_experiment_racing.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0012_stage3_business.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0013_admin_completion.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0014_password_auth.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0015_photo_shot_at.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0016_video_duration.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0017_pet_senior_stage.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0018_pet_weight_records.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0019_health_advisory.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0020_pricing_and_membership.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0021_membership_honest_entitlements.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0022_health_care_and_reminders.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0023_membership_health_entitlements.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0024_pet_island.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0025_owner_photos_and_ai_roles.sql"), "utf8"),
      readFile(path.join(process.cwd(), "drizzle", "0026_pet_human_identities.sql"), "utf8"),
    ]);
    for (const migration of migrations) await database.exec(migration);
    globalThis.__petbabyDatabaseMigrated = true;
  }
  return database;
}

export async function resetDatabaseForTest() {
  const database = await getDatabase();
  await database.exec("TRUNCATE user_notifications, pet_human_identities, owner_photos, plugin_config_versions, plugin_configs, refunds, rate_limits, system_usage, ai_cost_ledger, interactive_events, experiment_metrics, events, daily_quotas, health_daily_quotas, health_sessions, health_reminders, health_documents, pet_care_records, pet_weight_records, island_daily_actions, island_events, island_placements, island_inventory, island_pets, islands, audit_logs, operation_audit_logs, orders, generation_tasks, works, photos, pets, users CASCADE;");
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
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0024_pet_island.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0025_owner_photos_and_ai_roles.sql"), "utf8"));
  await database.exec(await readFile(path.join(process.cwd(), "drizzle", "0026_pet_human_identities.sql"), "utf8"));
}
