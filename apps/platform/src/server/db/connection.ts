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

declare global {
  var __petbabyDatabaseContext: AsyncLocalStorage<Database> | undefined;
}
// Next dev retains the global connection across route reloads. Its transaction
// context must have the same lifetime or nested queries wait on their own lock.
export const databaseContext = globalThis.__petbabyDatabaseContext ??= new AsyncLocalStorage<Database>();

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
    return postgresDatabase(postgres(url, {
      max: 10, idle_timeout: 20, connect_timeout: 10,
      // The SQL boundary uses encoded JSON text for both adapters. postgres.js
      // otherwise encodes these strings a second time after inferring jsonb OIDs.
      types: {
        json: { to: 114, from: [114, 3802], serialize: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value), parse: JSON.parse },
        jsonb: { to: 3802, from: [], serialize: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value), parse: JSON.parse },
        // Preserve six-digit keyset timestamps; converting SQL text to Date
        // truncates microseconds and repeats rows at a page boundary.
        date: { to: 1184, from: [1082, 1114, 1184], serialize: (value: unknown) => value instanceof Date ? value.toISOString() : String(value), parse: (value: string) => new Date(value) },
        calendarDate: { to: 1082, from: [1082], serialize: (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value), parse: (value: string) => value },
      },
    }));
  }
  if (url.startsWith("file://")) await mkdir(path.resolve(url.slice(7)), { recursive: true });
  return pgliteDatabase(url === "memory://" ? new PGlite() : new PGlite(url));
}
