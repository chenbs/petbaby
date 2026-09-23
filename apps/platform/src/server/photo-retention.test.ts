import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as maintain } from "@/app/api/internal/maintenance/route";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { cleanupExpiredContent } from "@/server/maintenance";
import { createPet, listPhotos, savePhoto } from "@/server/platform-service";
import { objectStorage } from "@/server/storage";

const USER = "00000000-0000-4000-8000-000000000033";
const bytes = new Uint8Array([1, 2, 3]);

describe("记录照片的跨日保留（A18）", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const db = await getDatabase();
    await db.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("自动轮次和鉴权维护入口多轮运行，均不删除无作品引用的旧照片", async () => {
    const pet = await createPet(USER, { name: "留存夹具", species: "cat" });
    const db = await getDatabase();
    const photos = [];
    for (const age of [2, 31]) {
      const storageKey = `private/${USER}/${crypto.randomUUID()}.png`;
      await objectStorage.put(storageKey, bytes, "image/png");
      const photo = await savePhoto(USER, { petId: pet.id, filename: "fixture.png", mimeType: "image/png", size: bytes.length, storageKey });
      await db.query("UPDATE photos SET created_at=now()-$2::int*interval '1 day' WHERE id=$1", [photo.id, age]);
      photos.push(photo);
    }
    await db.query("INSERT INTO rate_limits (id,scope,subject,window_start,hits) VALUES ($1,'retention-old','fixture',now()-interval '3 days',1)", [crypto.randomUUID()]);
    vi.stubEnv("WORKER_SECRET", "retention-test-secret");
    for (let round = 0; round < 3; round++) {
      expect((await cleanupExpiredContent()).photos).toBe(0);
      const response = await maintain(new Request("http://localhost/api/internal/maintenance", { method: "POST", headers: { authorization: "Bearer retention-test-secret" } }));
      expect(response.status).toBe(200);
      expect((await listPhotos(USER, pet.id)).map((photo) => photo.id)).toEqual(photos.map((photo) => photo.id));
      for (const photo of photos) expect((await objectStorage.get(photo.storageKey))?.body).toEqual(bytes);
    }
    expect(await db.query("SELECT * FROM rate_limits WHERE scope='retention-old'")).toHaveLength(0);
    expect(await db.query("SELECT id FROM generation_tasks WHERE user_id=$1", [USER])).toHaveLength(0);
    expect(await db.query("SELECT id FROM orders WHERE user_id=$1", [USER])).toHaveLength(0);
    expect((await maintain(new Request("http://localhost/api/internal/maintenance", { method: "POST" }))).status).toBe(404);
  });
});
