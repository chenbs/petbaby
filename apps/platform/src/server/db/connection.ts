import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import postgres from "postgres";

export type SqlRow = Record<string, unknown>;

export interface Database {
  query<T extends SqlRow>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(operation: (database: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const databaseContext = new AsyncLocalStorage<Database>();

function postgresDatabase(client: postgres.Sql | postgres.TransactionSql): Database {
  const database: Database = {
    async query<T extends SqlRow>(sql: string, params: unknown[] = []) {
      return [...await client.unsafe(sql, params as never[])] as unknown as T[];
    },
    async exec(sql) { await client.unsafe(sql); },
    async transaction<T>(operation: (database: Database) => Promise<T>): Promise<T> {
      if (!("begin" in client)) return operation(database);
      return await client.begin(async (transaction) => {
        const connection = postgresDatabase(transaction);
        return databaseContext.run(connection, () => operation(connection));
      }) as T;
    },
    async close() { if ("end" in client) await client.end(); },
  };
  return database;
}

function pgliteDatabase(client: PGlite | Transaction): Database {
  const database: Database = {
    async query<T extends SqlRow>(sql: string, params: unknown[] = []) {
      return (await client.query<T>(sql, params)).rows;
    },
    async exec(sql) { await client.exec(sql); },
    async transaction<T>(operation: (database: Database) => Promise<T>): Promise<T> {
      if (!("transaction" in client)) return operation(database);
      return client.transaction(async (transaction) => {
        const connection = pgliteDatabase(transaction);
        return databaseContext.run(connection, () => operation(connection));
      });
    },
    async close() { if ("close" in client) await client.close(); },
  };
  return database;
}

export async function createDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL || "file://.data/petbaby";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return postgresDatabase(postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 }));
  }
  if (url.startsWith("file://")) await mkdir(path.resolve(url.slice(7)), { recursive: true });
  return pgliteDatabase(url === "memory://" ? new PGlite() : new PGlite(url));
}
