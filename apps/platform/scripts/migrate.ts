import { createDatabase } from "../src/server/db/connection";
import { migrateDatabase } from "../src/server/db/migrate";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const database = await createDatabase();
  try {
    await migrateDatabase(database);
  } finally {
    await database.close();
  }
}

void main();
