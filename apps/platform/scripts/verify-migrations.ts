import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main() {
  if (!process.env.DATABASE_URL?.startsWith("postgres")) throw new Error("验证迁移必须连接 PostgreSQL");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const expected = (await readdir(path.resolve("drizzle"))).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
    const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migrations ORDER BY name`;
    assert.deepEqual(rows.map((row) => row.name), expected);
    for (const table of ["users", "pets", "photos", "works", "orders", "growth_orders", "entitlement_ledger"]) {
      const columns = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table}`;
      assert.ok(columns.length > 0, `缺少业务表 ${table}`);
    }
    console.log(`PostgreSQL 迁移登记与 ${expected.length} 个前向迁移一致，核心业务表存在。`);
  } finally { await sql.end(); }
}

void main();
