import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Database } from "./connection";

export async function migrateDatabase(database: Database) {
  await database.transaction(async (transaction) => {
    if (/^postgres(ql)?:/.test(process.env.DATABASE_URL || "")) await transaction.query("SELECT pg_advisory_xact_lock(7382014)");
    await transaction.exec("CREATE TABLE IF NOT EXISTS migration_lock (id integer PRIMARY KEY); INSERT INTO migration_lock (id) VALUES (1) ON CONFLICT DO NOTHING;");
    await transaction.query("SELECT id FROM migration_lock WHERE id=1 FOR UPDATE");
    await transaction.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL)");
    const directory = path.join(process.cwd(), "drizzle");
    const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort();
    const applied = new Set((await transaction.query("SELECT name FROM schema_migrations")).map((row) => String(row.name)));
    for (const name of names) {
      if (applied.has(name)) continue;
      await transaction.exec(await readFile(path.join(directory, name), "utf8"));
      await transaction.query("INSERT INTO schema_migrations (name,applied_at) VALUES ($1,now())", [name]);
    }
  });
}
