import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1 });
  try {
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL)`;
    const migrationDirectory = path.join(process.cwd(), "drizzle");
    const names = (await readdir(migrationDirectory)).filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name)).sort();
    for (const name of names) {
      const applied = await sql`SELECT name FROM schema_migrations WHERE name=${name}`;
      if (applied.length) continue;
      const migration = await readFile(path.join(migrationDirectory, name), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`INSERT INTO schema_migrations (name,applied_at) VALUES (${name},now())`;
      });
    }
  } finally {
    await sql.end();
  }
}

void main();
