import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { GET as uploadReceipt, POST as upload } from "@/app/api/uploads/route";
import { GET as photosRoute } from "@/app/api/photos/route";
import { GET as detailRoute, PATCH as editRoute } from "@/app/api/photos/[id]/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createPet, listPets } from "@/server/platform-service";
import { deletePhoto, getPhoto, getUploadReceipt, listPhotoPage, listPhotos, savePhoto, updateBatchPhotoMetadata, updatePhotoMetadata, updatePhotoOrder } from "@/server/photo-library-service";
import { compensateUpload, processObjectCleanupJobs, queueObjectCleanup } from "@/server/object-cleanup";
import { objectStorage } from "@/server/storage";
import { cleanupExpiredContent } from "@/server/maintenance";
import { findOnThisDay, getPetTimeline } from "@/server/timeline-service";

// 仅提供 Next 请求上下文，保留真实签名校验/用户状态/生产无匿名回退语义。
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const USER = "00000000-0000-4000-8000-000000000033";
const OTHER = "00000000-0000-4000-8000-000000000034";
let petId: string;
let otherPetId: string;
let png: Buffer;
const keys: string[] = [];

function headers(userId = USER) {
  return { authorization: `Bearer ${signSession(userId)}`, "x-petbaby-client": "miniprogram" };
}
function uploadRequest(requestId?: string, pet = petId, bytes = png, userId = USER) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "fixture.png", { type: "image/png" }));
  form.set("filename", "fixture.png");
  form.set("petId", pet);
  form.set("entry", "photos");
  if (requestId) form.set("uploadRequestId", requestId);
  return new Request("http://localhost/api/uploads", { method: "POST", headers: headers(userId), body: form });
}
async function fixturePhoto(pet = petId, userId = USER, requestId?: string) {
  const storageKey = `private/${userId}/${crypto.randomUUID()}.png`;
  keys.push(storageKey);
  await objectStorage.put(storageKey, png, "image/png");
  return savePhoto(userId, { petId: pet, filename: "fixture.png", storageKey, mimeType: "image/png", size: png.length, uploadRequestId: requestId, contentSha256: createHash("sha256").update(png).digest("hex") });
}

beforeEach(async () => {
  await resetDatabaseForTest();
  const db = await getDatabase();
  await db.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  petId = (await createPet(USER, { name: "甲的 A", species: "cat" })).id;
  otherPetId = (await createPet(OTHER, { name: "乙的猫", species: "cat" })).id;
  png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "record-route-test-secret-with-32-characters"); // gitleaks:allow -- 仅用于测试夹具签名，不是部署凭据。
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const key of keys.splice(0)) await objectStorage.delete(key);
});

describe("上传回执与兼容（A01/A02/A03/A07/A10/A15）", () => {
  it("并发重放只存一张并只记一次事实，同键换文件/宠物拒绝，旧端仍为 Photo", async () => {
    const requestId = crypto.randomUUID();
    const responses = await Promise.all([upload(uploadRequest(requestId)), upload(uploadRequest(requestId))]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const data = await Promise.all(responses.map(async (response) => (await response.json()).data));
    expect(data[0].id).toBe(data[1].id);
    const db = await getDatabase();
    expect(await db.query("SELECT id FROM photos WHERE upload_request_id=$1", [requestId])).toHaveLength(1);
    expect(await db.query("SELECT id FROM events WHERE name='upload_completed'")).toHaveLength(1);
    const receipt = await uploadReceipt(new Request(`http://localhost/api/uploads?requestId=${requestId}`, { headers: headers() }));
    expect((await receipt.json()).data).toMatchObject({ status: "saved", photo: { id: data[0].id } });
    const black = await sharp({ create: { width: 16, height: 16, channels: 3, background: "black" } }).png().toBuffer();
    expect((await upload(uploadRequest(requestId, petId, black))).status).toBe(409);
    const secondPet = await createPet(USER, { name: "甲的 B", species: "dog" });
    expect((await upload(uploadRequest(requestId, secondPet.id))).status).toBe(409);
    const old = await upload(uploadRequest());
    expect(old.status).toBe(201);
    expect((await old.json()).data).toMatchObject({ petId, shotAtSource: "upload", caption: "", tags: [], metadataVersion: 1, memoryDate: null });
    expect(await db.query("SELECT id FROM generation_tasks")).toHaveLength(0);
    expect(await db.query("SELECT id FROM daily_quotas")).toHaveLength(0);
    expect(await db.query("SELECT id FROM orders")).toHaveLength(0);
    expect((await listPets(USER))[0].counts?.photos).toBe(2);
  });

  it("重选照片允许保留，只向同账号同宠提示重复", async () => {
    const original = await fixturePhoto();
    expect((await fixturePhoto()).duplicatePhotoId).toBe(original.id);
    expect((await fixturePhoto(otherPetId, OTHER)).duplicatePhotoId).toBeUndefined();
    const secondPet = await createPet(USER, { name: "B", species: "dog" });
    expect((await fixturePhoto(secondPet.id)).duplicatePhotoId).toBeUndefined();
  });

  it("真实会话拒绝匿名/乙的详情、回执、列表及跨宠上传，删除重放返回墓碑", async () => {
    const requestId = crypto.randomUUID();
    const photo = await fixturePhoto(petId, USER, requestId);
    const context = { params: Promise.resolve({ id: photo.id }) };
    expect((await detailRoute(new Request("http://localhost/api/photos/x"), context)).status).toBe(401);
    expect((await detailRoute(new Request("http://localhost/api/photos/x", { headers: headers(OTHER) }), context)).status).toBe(404);
    expect((await uploadReceipt(new Request(`http://localhost/api/uploads?requestId=${requestId}`, { headers: headers(OTHER) }))).status).toBe(404);
    expect((await photosRoute(new Request(`http://localhost/api/photos?petId=${petId}`, { headers: headers(OTHER) }))).status).toBe(404);
    expect((await upload(uploadRequest(crypto.randomUUID(), otherPetId))).status).toBe(404);
    await deletePhoto(USER, photo.id);
    expect(await deletePhoto(USER, photo.id)).toEqual({ deleted: true });
    expect(await getUploadReceipt(USER, requestId)).toEqual({ status: "deleted", photoId: photo.id });
    const replay = await upload(uploadRequest(requestId));
    expect(replay.status).toBe(200);
    expect((await replay.json()).data).toEqual({ status: "deleted", photoId: photo.id });
    await cleanupExpiredContent();
    expect(await getUploadReceipt(USER, requestId)).toEqual({ status: "deleted", photoId: photo.id });
    expect(await listPhotos(USER, petId)).toEqual([]);
    await expect(getPhoto(USER, photo.id)).rejects.toMatchObject({ status: 404 });
    expect(await objectStorage.get(photo.storageKey)).toBeNull();
  });

  it("9 张中两次对象写入失败，成功项保留，只重试失败请求", async () => {
    const ids = Array.from({ length: 9 }, () => crypto.randomUUID());
    const put = objectStorage.put.bind(objectStorage);
    let attempts = 0;
    vi.spyOn(objectStorage, "put").mockImplementation(async (...args) => {
      attempts++;
      if (attempts === 3 || attempts === 7) throw new Error("injected-storage-failure");
      return put(...args);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed: string[] = [];
    for (const id of ids) if ((await upload(uploadRequest(id))).status !== 201) failed.push(id);
    expect(failed).toHaveLength(2);
    expect(await listPhotos(USER, petId)).toHaveLength(7);
    for (const id of failed) expect((await upload(uploadRequest(id))).status).toBe(201);
    expect(attempts).toBe(11);
    expect(new Set((await listPhotos(USER, petId)).map((photo) => photo.id)).size).toBe(9);
    const db = await getDatabase();
    expect(await db.query("SELECT id FROM events WHERE name='upload_completed'")).toHaveLength(9);
  });
});

describe("元数据和分页（A04/A05/A08/A17）", () => {
  it("日期校正不改原日期、可清空、版本冲突，批次失败全部回滚", async () => {
    const a = await fixturePhoto();
    const b = await fixturePhoto();
    const updated = await updatePhotoMetadata(USER, a.id, { version: 1, memoryDate: "2024-02-29", caption: "春天", tags: ["walk"] });
    expect(updated).toMatchObject({ recordedDate: "2024-02-29", memoryDateSource: "manual", shotAt: a.shotAt, createdAt: a.createdAt, metadataVersion: 2 });
    await expect(updatePhotoMetadata(USER, a.id, { version: 1, caption: "冲突" })).rejects.toMatchObject({ code: "PHOTO_VERSION_CONFLICT" });
    await expect(updateBatchPhotoMetadata(USER, petId, { photos: [{ photoId: b.id, version: 1 }, { photoId: a.id, version: 1 }], caption: "不该保存" })).rejects.toMatchObject({ code: "PHOTO_VERSION_CONFLICT" });
    expect((await getPhoto(USER, b.id)).caption).toBe("");
    const batch = await updateBatchPhotoMetadata(USER, petId, { photos: [{ photoId: a.id, version: 2 }, { photoId: b.id, version: 1 }], caption: "一起散步", tags: ["walk", "keep"] });
    expect(batch.every((photo) => photo.caption === "一起散步")).toBe(true);
    const cleared = await updatePhotoMetadata(USER, a.id, { version: 3, memoryDate: null, caption: "", tags: [] });
    expect(cleared).toMatchObject({ memoryDate: null, memoryDateSource: "upload", caption: "", tags: [], shotAt: a.shotAt });
    for (const input of [{ memoryDate: "2023-02-29" }, { memoryDate: "2999-01-01" }, { caption: "a".repeat(121) }, { tags: ["diagnosis"] }, { tags: ["keep", "keep"] }]) {
      const response = await editRoute(new Request("http://localhost/api/photos/x", { method: "PATCH", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ version: 4, ...input }) }), { params: Promise.resolve({ id: a.id }) });
      expect(response.status).toBe(422);
    }
    expect(await listPhotos(USER, petId)).toHaveLength(2);
  });

  it("时间线使用手工日期、隐藏起点前天数，纪念无截止日不给递增数字", async () => {
    const photo = await fixturePhoto();
    const db = await getDatabase();
    await db.query("UPDATE pets SET birthday='2024-01-01' WHERE id=$1", [petId]);
    await updatePhotoMetadata(USER, photo.id, { version: 1, memoryDate: "2023-12-31" });
    let timeline = await getPetTimeline(USER, petId, { pageSize: 50 });
    expect(timeline.entries[0]).toMatchObject({ date: "2023-12-31", dateSource: "manual", showDay: false });
    await db.query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [petId]);
    timeline = await getPetTimeline(USER, petId, { pageSize: 50 });
    expect(timeline.totalDays).toBe(0);
    expect(timeline.milestones).toEqual([]);
    expect(timeline.entries[0].milestone).toBeUndefined();
    await db.query("UPDATE photos SET shot_at=$2,memory_date=NULL WHERE id=$1", [photo.id, new Date(2024, 6, 30, 12)]);
    expect(await findOnThisDay(USER, new Date(2026, 6, 30, 12), petId)).toHaveLength(1);
    await updatePhotoMetadata(USER, photo.id, { version: 2, memoryDate: "2024-07-29" });
    expect(await findOnThisDay(USER, new Date(2026, 6, 30, 12), petId)).toHaveLength(0);
  });

  it("550 张同日同时间跨年照片在三种顺序下完整可达，游标不可跨用户/宠物/排序复用", async () => {
    const db = await getDatabase();
    await db.query(`INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,created_at,shot_at)
      SELECT gen_random_uuid(),$1,$2,'fixture.png','image/png',1,'fixtures/'||n||'.png',n,
        '2026-01-01T00:00:00.123456Z'::timestamptz,
        '2024-01-01T00:00:00Z'::timestamptz+(n%400)*interval '1 day' FROM generate_series(1,550) n`, [USER, petId]);
    for (const order of ["library", "uploaded", "recorded"] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listPhotoPage(USER, { petId, pageSize: 50, order, cursor });
        expect(page.totalCount).toBe(550);
        seen.push(...page.items.map((photo) => photo.id));
        cursor = page.nextCursor || undefined;
      } while (cursor);
      expect(seen).toHaveLength(550);
      expect(new Set(seen).size).toBe(550);
    }
    const timelineIds: string[] = [];
    let timelineCursor: string | undefined;
    do {
      const timeline = await getPetTimeline(USER, petId, { pageSize: 50, cursor: timelineCursor });
      expect(timeline.totalCount).toBe(550);
      timelineIds.push(...timeline.entries.map((entry) => entry.photo.id));
      timelineCursor = timeline.nextCursor || undefined;
    } while (timelineCursor);
    expect(timelineIds).toHaveLength(550);
    expect(new Set(timelineIds).size).toBe(550);
    expect((await getPetTimeline(USER, petId, { limit: 500 })).entries).toHaveLength(500);
    const page = await listPhotoPage(USER, { petId, pageSize: 50 });
    await expect(listPhotoPage(USER, { petId, order: "recorded", cursor: page.nextCursor })).rejects.toMatchObject({ code: "PHOTO_CURSOR_INVALID" });
    await expect(listPhotoPage(OTHER, { petId: otherPetId, cursor: page.nextCursor })).rejects.toMatchObject({ code: "PHOTO_CURSOR_INVALID" });
    const photo = page.items[0];
    await updatePhotoMetadata(USER, photo.id, { version: 1, memoryDate: "2020-01-01" });
    expect((await listPhotoPage(USER, { petId, order: "recorded", direction: "asc" })).items[0].id).toBe(photo.id);
    await deletePhoto(USER, photo.id);
    expect((await listPhotoPage(USER, { petId })).totalCount).toBe(549);
    const legacy = await photosRoute(new Request(`http://localhost/api/photos?petId=${petId}`, { headers: headers() }));
    expect(Array.isArray((await legacy.json()).data)).toBe(true);
    const all = await listPhotos(USER, petId);
    await updatePhotoOrder(USER, petId, all.map((photo) => photo.id).reverse());
    expect((await listPhotos(USER, petId))[0].id).toBe(all[all.length - 1].id);
    await expect(updatePhotoOrder(USER, petId, all.map(() => all[0].id))).rejects.toMatchObject({ code: "PHOTO_ORDER_INVALID" });
  });
});

describe("持久清理（A11/A18）", () => {
  it("对象删除失败仍立即软删，保留任务并退避重试，活照片不会被错误清理", async () => {
    const photo = await fixturePhoto();
    const db = await getDatabase();
    const del = vi.spyOn(objectStorage, "delete").mockRejectedValue(new Error("injected"));
    await deletePhoto(USER, photo.id);
    expect(await listPhotos(USER, petId)).toHaveLength(0);
    expect((await db.query("SELECT * FROM object_cleanup_jobs WHERE photo_id=$1", [photo.id]))[0]).toMatchObject({ status: "pending", attempts: 1, last_error: "STORAGE_DELETE_FAILED" });
    del.mockRestore();
    await db.query("UPDATE object_cleanup_jobs SET next_attempt_at=now()");
    expect((await processObjectCleanupJobs()).completed).toBe(1);
    expect(await objectStorage.get(photo.storageKey)).toBeNull();
    const live = await fixturePhoto();
    await queueObjectCleanup(live.storageKey, "test_wrong_candidate");
    expect((await processObjectCleanupJobs()).completed).toBe(0);
    expect(await objectStorage.get(live.storageKey)).not.toBeNull();
    const failedKey = `private/${USER}/${crypto.randomUUID()}.png`;
    await objectStorage.put(failedKey, png, "image/png");
    await compensateUpload(failedKey);
    expect(await objectStorage.get(failedKey)).toBeNull();
  });

  it("已删宠物的照片不能读取、编辑或继续上传", async () => {
    const requestId = crypto.randomUUID();
    const photo = await fixturePhoto(petId, USER, requestId);
    await (await getDatabase()).query("UPDATE pets SET deleted_at=now() WHERE id=$1", [petId]);
    await expect(getPhoto(USER, photo.id)).rejects.toMatchObject({ status: 404 });
    await expect(getUploadReceipt(USER, requestId)).rejects.toMatchObject({ status: 404 });
    await expect(updatePhotoMetadata(USER, photo.id, { version: 1, caption: "不能写" })).rejects.toMatchObject({ status: 404 });
    await expect(listPhotos(USER, petId)).rejects.toMatchObject({ status: 404 });
    expect((await upload(uploadRequest(crypto.randomUUID()))).status).toBe(404);
    expect(await listPhotos(USER)).toEqual([]);
  });
});
