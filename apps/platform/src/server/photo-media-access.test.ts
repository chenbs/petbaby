import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { GET as media } from "@/app/api/media/[...key]/route";
import { GET as shareMedia } from "@/app/api/share/[token]/media/[asset]/route";
import { GET as interactiveMedia } from "@/app/api/interactive-share/[token]/media/[photoId]/route";
import { GET as memorialMedia } from "@/app/api/memorial-share/[token]/media/[photoId]/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, inTransaction, resetDatabaseForTest } from "@/server/db/client";
import { createGeneration, createPet, createOrder, deletePet, getGeneration, getSharedWork, getWork, revokeShare, shareWork } from "@/server/platform-service";
import { runWorkerUntilIdle } from "@/server/worker/generation-worker";
import { deletePhoto, savePhoto, updatePhotoMetadata } from "@/server/photo-library-service";
import { createInteractiveSession, createVideoRender, exportInteractiveSession, revokeInteractiveShare, shareInteractiveSession } from "@/server/growth-service";
import { cancelVideoRender } from "@/server/video/service";
import { ensurePhotoDeliverableAsset } from "@/server/photo-deliverable-assets";
import { createMemorialSpace, getPublicMemorial, updateMemorialSpace } from "@/server/memorial-service";
import { deleteAccount } from "@/server/account-service";
import { processObjectCleanupJobs } from "@/server/object-cleanup";
import { objectStorage } from "@/server/storage";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const USER = "00000000-0000-4000-8000-000000000073";
const OTHER = "00000000-0000-4000-8000-000000000074";
let petId: string;
let photo: Awaited<ReturnType<typeof savePhoto>>;
let image: Buffer;
function request(user?: string, path = "http://localhost/api/media/a.png") { return new Request(path, { headers: user ? { authorization: `Bearer ${signSession(user)}` } : {} }); }
function original(user?: string) { return media(request(user), { params: Promise.resolve({ key: photo.storageKey.split("/") }) }); }
function publicMedia(token: string, asset = "cover", code?: string) { return shareMedia(request(undefined, `http://localhost/api/share/${token}/media/${asset}${code ? `?code=${code}` : ""}`), { params: Promise.resolve({ token, asset }) }); }
async function work(kind = "image", previewOriginal = false) {
  const id = crypto.randomUUID();
  const key = `private/${USER}/works/${id}.png`;
  await objectStorage.put(key, image, "image/png");
  await (await getDatabase()).query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,locked,public,version,asset_kind,created_at) VALUES ($1,$2,'pet-id-card',$3,$4,'fixture','','fixture','fixture',$5,$6,false,false,1,$7,now())", [id, USER, petId, photo.id, key, previewOriginal ? photo.storageKey : key, kind]);
  return id;
}
beforeEach(async () => {
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  petId = (await createPet(USER, { name: "私密小猫", species: "cat" })).id;
  image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "orange" } }).png().toBuffer();
  const key = `private/${USER}/${crypto.randomUUID()}.png`;
  await objectStorage.put(key, image, "image/png");
  photo = await savePhoto(USER, { petId, filename: "private.png", storageKey: key, mimeType: "image/png", size: image.length });
  await updatePhotoMetadata(USER, photo.id, { version: 1, caption: "不能泄漏的私密短句", tags: ["keep"], memoryDate: "2020-01-01" });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "private-media-test-secret-over-32-characters");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("私人照片与交付物隔离（A10/A11/A16）", () => {
  it.each(["pl-23", "pet-time-album"])("A13：记录照片进入 %s，免费交付或未付款后照片仍能回看下载", async (pluginId) => {
    const photoIds = [photo.id];
    for (let index = 1; index < (pluginId === "pl-23" ? 2 : 6); index++) {
      const key = `private/${USER}/${crypto.randomUUID()}.png`;
      await objectStorage.put(key, image, "image/png");
      photoIds.push((await savePhoto(USER, { petId, filename: "record.png", mimeType: "image/png", storageKey: key, size: image.length, shotAt: new Date("2025-01-01") })).id);
    }
    const task = await createGeneration(USER, { petId, pluginId, photoIds, idempotencyKey: crypto.randomUUID() });
    await runWorkerUntilIdle();
    const completed = await getGeneration(USER, task.id);
    expect(completed.status).toBe("succeeded");
    expect(completed.work?.petId).toBe(petId);
    if (pluginId === "pl-23") {
      expect(completed.work?.locked).toBe(false);
      await expect(createOrder(USER, completed.work!.id)).rejects.toMatchObject({ code: "ORDER_NOT_REQUIRED" });
      const output = await objectStorage.get(completed.work!.outputKey!);
      const preview = await objectStorage.get(completed.work!.previewKey!);
      expect(output).toBeTruthy(); expect(Buffer.from(output!.body)).toEqual(Buffer.from(preview!.body));
    } else {
      const order = await createOrder(USER, completed.work!.id);
      expect(order.status).toBe("pending"); expect(order.amount).toBeGreaterThan(0);
      // 用户在付款前离开：未调用支付确认，不赋予收费权益，也不影响基础记录。
      expect((await getWork(USER, completed.work!.id)).locked).toBe(true);
    }
    expect(Buffer.from(await (await original(USER)).arrayBuffer())).toEqual(image);
    expect((await (await getDatabase()).query("SELECT id FROM photos WHERE user_id=$1 AND deleted_at IS NULL", [USER])).length).toBe(photoIds.length);
  });

  it.each(["jpeg", "png", "webp"] as const)("A16：%s 保管文件通过已有私有媒体出口逐字节带走，源对象缺失返回失败", async (format) => {
    const body = await sharp({ create: { width: 40, height: 40, channels: 3, background: "teal" } }).toFormat(format).toBuffer();
    const key = `private/${USER}/${crypto.randomUUID()}.${format}`;
    await objectStorage.put(key, body, `image/${format}`);
    await savePhoto(USER, { petId, filename: `fixture.${format}`, mimeType: `image/${format}`, storageKey: key, size: body.length });
    const load = () => media(request(USER), { params: Promise.resolve({ key: key.split("/") }) });
    expect(Buffer.from(await (await load()).arrayBuffer())).toEqual(body);
    await objectStorage.delete(key);
    expect((await load()).status).toBe(404);
  });

  it("旧视频入口拒绝跨账号和跨宠素材；处理中的任务不能通过取消绕过删除保护", async () => {
    await expect(createVideoRender(OTHER, { pluginId: "pl-19", photos: [photo.storageKey] })).rejects.toMatchObject({ code: "PHOTO_PET_MISMATCH" });
    const render = await createVideoRender(USER, { pluginId: "pl-19", photos: [photo.storageKey] });
    const db = await getDatabase();
    await db.query("UPDATE video_renders SET status='processing' WHERE id=$1", [render.id]);
    await expect(cancelVideoRender(USER, render.id)).rejects.toMatchObject({ status: 409 });
    await expect(deletePhoto(USER, photo.id)).rejects.toMatchObject({ code: "PHOTO_IN_USE" });
    await db.query("UPDATE video_renders SET status='failed' WHERE id=$1", [render.id]);
    const queued = await createVideoRender(USER, { pluginId: "pl-19", photos: [photo.storageKey] });
    await cancelVideoRender(USER, queued.id);
    await deletePhoto(USER, photo.id);
    expect((await original(USER)).status).toBe(404);
  });

  it("衍生资源写入后事务回滚，清理失败仍保留持久重试，原照不受影响", async () => {
    const id = await work();
    let key = "";
    const deletion = vi.spyOn(objectStorage, "delete").mockRejectedValue(new Error("offline"));
    await expect(inTransaction(async () => {
      key = await ensurePhotoDeliverableAsset(USER, petId, "work", id, photo.id);
      throw new Error("rollback fixture");
    })).rejects.toThrow("rollback fixture");
    const db = await getDatabase();
    expect(await db.query("SELECT id FROM photo_deliverable_assets")).toHaveLength(0);
    expect(await db.query("SELECT id FROM object_cleanup_jobs WHERE storage_key=$1 AND status='pending'", [key])).toHaveLength(1);
    deletion.mockRestore();
    await db.query("UPDATE object_cleanup_jobs SET next_attempt_at=now()");
    await processObjectCleanupJobs();
    expect(await objectStorage.get(key)).toBeNull();
    expect((await original(USER)).status).toBe(200);
  });

  it("公开作品不开放原照；令牌/访问码保护独立封面和成品，元数据不随分享返回", async () => {
    const id = await work();
    const { token } = await shareWork(USER, id, { accessCode: "1234" });
    expect((await original()).status).toBe(404);
    expect((await original(OTHER)).status).toBe(404);
    const own = await original(USER);
    expect(own.status).toBe(200);
    expect(Buffer.from(await own.arrayBuffer())).toEqual(image);
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect((await publicMedia(token)).status).toBe(401);
    const shared = await getSharedWork(token, "1234");
    expect(Object.keys(shared.photo).sort()).toEqual(["id", "url"]);
    expect(JSON.stringify(shared)).not.toContain("不能泄漏");
    expect(JSON.stringify(shared)).not.toContain(photo.storageKey);
    for (const asset of ["cover", "output"]) {
      const response = await publicMedia(token, asset, "1234");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    await revokeShare(USER, id);
    expect((await publicMedia(token, "cover", "1234")).status).toBe(404);
    const renewed = await shareWork(USER, id);
    await (await getDatabase()).query("UPDATE works SET share_expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    expect((await publicMedia(renewed.token)).status).toBe(410);
  });

  it("删除原照后排版/AI/视频/PDF封面和成品保持可读，原照立即不可读且不能再制作", async () => {
    const ids = [];
    for (const kind of ["image", "image", "video", "pdf", "h5"]) ids.push(await work(kind, true));
    const shares = [];
    for (const id of ids) shares.push(await shareWork(USER, id));
    await deletePhoto(USER, photo.id);
    expect((await original(USER)).status).toBe(404);
    expect(await objectStorage.get(photo.storageKey)).toBeNull();
    for (const [i, item] of shares.entries()) {
      expect((await publicMedia(item.token)).status).toBe(200);
      expect((await publicMedia(item.token, "output")).status).toBe(200);
      expect((await getWork(USER, ids[i])).photo.url).not.toBe(photo.url);
    }
    await expect(createGeneration(USER, { petId, photoIds: [photo.id], pluginId: "pet-id-card", idempotencyKey: crypto.randomUUID() })).rejects.toMatchObject({ code: "PHOTO_PET_MISMATCH" });
  });

  it("互动/纪念独立出口不传播记录，保留已用图片；撤销和删宠即时拒绝新读取", async () => {
    const session = await createInteractiveSession(USER, { petId, pluginId: "pl-15", photoIds: [photo.id], snapshot: { title: "记住", copy: "已确认的作品文案", theme: "stardust" } });
    const shared = await shareInteractiveSession(USER, session.id, {});
    const token = shared.shareToken!;
    const interactive = () => interactiveMedia(request(), { params: Promise.resolve({ token, photoId: photo.id }) });
    const space = await createMemorialSpace(USER, { petId, title: "纪念", photoIds: [photo.id] });
    const memorial = await updateMemorialSpace(USER, String(space.id), { title: "纪念", story: "作品故事", theme: "stardust", photoIds: [photo.id], visibility: "shared" });
    const mt = String(memorial.share_token);
    const remembered = () => memorialMedia(request(), { params: Promise.resolve({ token: mt, photoId: photo.id }) });
    expect((await interactive()).status).toBe(200);
    expect((await remembered()).status).toBe(200);
    expect(JSON.stringify(await getPublicMemorial(mt))).not.toContain("不能泄漏");
    await deletePhoto(USER, photo.id);
    expect((await interactive()).status).toBe(200);
    expect((await remembered()).status).toBe(200);
    await revokeInteractiveShare(USER, session.id);
    expect((await interactive()).status).toBe(410);
    await deletePet(USER, petId);
    expect((await remembered()).status).toBe(410);
  });

  it("互动任务在途阻止删除，整宠/注销的清理失败持久重试", async () => {
    const session = await createInteractiveSession(USER, { petId, pluginId: "pl-15", photoIds: [photo.id], snapshot: { title: "记住", copy: "文案", theme: "stardust" } });
    await exportInteractiveSession(USER, session.id);
    await expect(deletePhoto(USER, photo.id)).rejects.toMatchObject({ code: "PHOTO_IN_USE" });
    await expect(deletePet(USER, petId)).rejects.toMatchObject({ code: "PHOTO_IN_USE" });
    await (await getDatabase()).query("UPDATE video_renders SET status='cancelled' WHERE user_id=$1", [USER]);
    const deletion = vi.spyOn(objectStorage, "delete").mockRejectedValue(new Error("storage offline"));
    await deleteAccount(USER);
    expect((await original(USER)).status).not.toBe(200);
    const db = await getDatabase();
    expect(await db.query("SELECT id FROM object_cleanup_jobs WHERE status='pending'")).not.toHaveLength(0);
    deletion.mockRestore();
    await db.query("UPDATE object_cleanup_jobs SET next_attempt_at=now() WHERE status='pending'");
    await processObjectCleanupJobs();
    expect(await objectStorage.get(photo.storageKey)).toBeNull();
  });
});
