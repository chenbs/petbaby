import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./connection";
import { migrateDatabase } from "./migrate";

async function isolatedDatabase() {
  const url = process.env.RECORD_TEST_PG_URL;
  if (!url) {
    vi.stubEnv("DATABASE_URL", "memory://");
    const db = await createDatabase();
    return { db, close: () => db.close() };
  }
  const admin = postgres(url);
  const name = `record_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const target = new URL(url); target.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", target.toString());
  const db = await createDatabase();
  return { db, close: async () => { await db.close(); await admin.unsafe(`DROP DATABASE ${name}`); await admin.end(); } };
}

afterEach(() => vi.unstubAllEnvs());
describe("照片记录迁移（A17）", () => {
  it("旧库升级、重复迁移不改写原文件/拍摄时刻/上传时刻，默认值与唯一键可用", async () => {
    const { db, close } = await isolatedDatabase();
    try {
      await db.exec("CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL)");
      const directory = path.join(process.cwd(), "drizzle");
      for (const name of (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < "0030").sort()) {
        await db.exec(await readFile(path.join(directory, name), "utf8"));
        await db.query("INSERT INTO schema_migrations VALUES ($1,now())", [name]);
      }
      const user = crypto.randomUUID(), pet = crypto.randomUUID(), photo = crypto.randomUUID();
      await db.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [user]);
      await db.query("INSERT INTO pets (id,user_id,name,species,gender,created_at) VALUES ($1,$2,'旧档案','cat','unknown',now())", [pet, user]);
      await db.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,created_at,shot_at) VALUES ($1,$2,$3,'old.jpg','image/jpeg',100,'private/old.jpg','2026-01-01Z','2024-02-29Z')", [photo, user, pet]);
      const render = crypto.randomUUID();
      const legacyConfig = { petId: pet, photoIds: [photo], photos: ["private/old.jpg"] };
      await db.query("INSERT INTO video_renders (id,user_id,plugin_id,status,config,created_at) VALUES ($1,$2,'pl-19','queued',to_jsonb($3::text),now())", [render, user, JSON.stringify(legacyConfig)]);
      const [before] = await db.query("SELECT * FROM photos WHERE id=$1", [photo]);
      await migrateDatabase(db);
      await migrateDatabase(db);
      const [after] = await db.query("SELECT * FROM photos WHERE id=$1", [photo]);
      expect(after).toMatchObject({ ...before, memory_date: null, caption: "", tags: [], metadata_version: 1, upload_request_id: null, content_sha256: null });
      expect(await db.query("SELECT name FROM schema_migrations WHERE name='0030_photo_memories.sql'")).toHaveLength(1);
      expect(await db.query("SELECT * FROM object_cleanup_jobs")).toEqual([]);
      expect(await db.query("SELECT * FROM photo_deliverable_assets")).toEqual([]);
      const [repaired] = await db.query("SELECT config,config->'photoIds' @> $2::jsonb AS protected FROM video_renders WHERE id=$1", [render, JSON.stringify([photo])]);
      expect(repaired).toEqual({ config: legacyConfig, protected: true });
      expect(await db.query("SELECT indexname FROM pg_indexes WHERE indexname='record_event_session_idx'")).toHaveLength(1);
      const key = crypto.randomUUID();
      await db.query("UPDATE photos SET upload_request_id=$2,deleted_at=now() WHERE id=$1", [photo, key]);
      await expect(db.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,created_at,upload_request_id) VALUES ($1,$2,$3,'new.jpg','image/jpeg',100,'private/new.jpg',now(),$4)", [crypto.randomUUID(), user, pet, key])).rejects.toMatchObject({ code: "23505" });
    } finally { await close(); }
  });

  it("空库初始化并重复迁移保留完整照片记录结构", async () => {
    const { db, close } = await isolatedDatabase();
    try {
      await migrateDatabase(db);
      await migrateDatabase(db);
      const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='photos'")).map((row) => row.column_name);
      expect(columns).toEqual(expect.arrayContaining(["memory_date", "caption", "tags", "metadata_version", "metadata_updated_at", "upload_request_id", "content_sha256"]));
      const [json] = await db.query("SELECT $1::jsonb AS value, jsonb_typeof($1::jsonb) AS kind, $1::jsonb @> $2::jsonb AS contains", [JSON.stringify({ photos: ["a", "b"] }), JSON.stringify({ photos: ["b"] })]);
      expect(json).toEqual({ value: { photos: ["a", "b"] }, kind: "object", contains: true });
      const [precision] = await db.query("SELECT to_char($1::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp", ["2026-01-01T00:00:00.123456Z"]);
      expect(precision.stamp).toBe("2026-01-01T00:00:00.123456Z");
    } finally { await close(); }
  });
});
