import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createPet } from "@/server/platform-service";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const USER = "00000000-0000-4000-8000-000000000083";
let petId: string;
beforeEach(async () => {
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
  petId = (await createPet(USER, { name: "记录", species: "cat" })).id;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "record-events-test-secret-over-32-characters");
});
afterEach(() => vi.unstubAllEnvs());
function send(name: string, metadata: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/events", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${signSession(USER)}`, "x-petbaby-client": "miniprogram" }, body: JSON.stringify({ name, channel: "miniprogram", metadata }) }));
}
it("A15：观察事件白名单、会话并发去重，不接受端上伪造保存/成交或私密内容", async () => {
  const sessionId = crypto.randomUUID();
  const responses = await Promise.all(Array.from({ length: 4 }, () => send("memory_viewed", { sessionId, petId, viewType: "timeline" })));
  for (const response of responses) expect(response.status, await response.text()).toBe(201);
  const db = await getDatabase();
  expect(await db.query("SELECT id FROM events WHERE name='memory_viewed'")).toHaveLength(1);
  expect((await send("memory_viewed", { sessionId, petId, viewType: "detail" })).status).toBe(201);
  expect((await send("record_entry_opened", { sessionId, entry: "photos" })).status).toBe(201);
  expect((await send("record_deliverable_opened", { petId, productId: "pet-time-album", entry: "photos" })).status).toBe(201);
  for (const name of ["paid", "upload_completed", "photo_metadata_saved"]) expect((await send(name, {})).status).toBe(422);
  expect((await send("memory_viewed", { sessionId, petId, viewType: "timeline", caption: "private", url: "/api/media/photo.jpg" })).status).toBe(422);
  expect((await send("memory_viewed", { sessionId, petId: crypto.randomUUID(), viewType: "timeline" })).status).toBe(404);
  const rows = await db.query("SELECT metadata FROM events WHERE name IN ('memory_viewed','record_entry_opened','record_deliverable_opened')");
  expect(JSON.stringify(rows)).not.toContain("private");
  expect(await db.query("SELECT id FROM orders")).toHaveLength(0);
});
