import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readBundleImage } from "@/app/api/art-photo-bundles/[id]/items/[itemId]/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { PET_ART_PHOTO_SCENE_IDS } from "@/domain/pet-art-photo";
import { processNextAiRun } from "@/server/growth-service";
import { ART_PHOTO_BUNDLE_PACKAGES, cancelArtPhotoBundle, createArtPhotoBundle, getArtPhotoBundle } from "./art-photo-bundle-service";
import { getWallet } from "@/server/wallet/service";
import { fundWallet } from "@/server/wallet/test-helpers";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const USER = "00000000-0000-4000-8000-000000000081";
const OTHER = "00000000-0000-4000-8000-000000000084";
const PET = "00000000-0000-4000-8000-000000000082";
const PHOTO = "00000000-0000-4000-8000-000000000083";
const PHOTO_KEY = `private/${USER}/photos/milo.png`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");

function request(batchId: string, itemId: string, userId?: string, preview = false) {
  return readBundleImage(new Request(`http://localhost/api/art-photo-bundles/${batchId}/items/${itemId}${preview ? "?preview=1" : ""}`, {
    headers: userId ? { authorization: `Bearer ${signSession(userId)}` } : {},
  }), { params: Promise.resolve({ id: batchId, itemId }) });
}

async function createAndPay(packageMode: "ten" | "twenty", key: string) {
  const sceneIds = PET_ART_PHOTO_SCENE_IDS.slice(0, ART_PHOTO_BUNDLE_PACKAGES[packageMode].count);
  const created = await createArtPhotoBundle(USER, { package: packageMode, petId: PET, photoId: PHOTO, sceneIds, idempotencyKey: key });
  return { created };
}

async function balance(userId = USER) { return (await getWallet(userId)).balance; }

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("PAYMENT_PROVIDER", "development");
  await resetDatabaseForTest();
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Milo','cat','unknown','birthday','active',true,now())", [PET, USER]);
  await database.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,'milo.png','image/png',1,$4,0,'clear',now())", [PHOTO, USER, PET, PHOTO_KEY]);
  await objectStorage.put(PHOTO_KEY, PNG, "image/png");
  await fundWallet(USER, 100);
});

describe("艺术写真套餐队列", () => {
  it("10 张套餐扣 12 颗冻干并在同一事务内入队，没有现金订单", async () => {
    await expect(createArtPhotoBundle(USER, { package: "ten", petId: PET, photoId: PHOTO, sceneIds: PET_ART_PHOTO_SCENE_IDS.slice(0, 9), idempotencyKey: "ten-wrong-count" })).rejects.toMatchObject({ code: "ART_PHOTO_SCENE_COUNT_INVALID" });
    const created = await createArtPhotoBundle(USER, { package: "ten", petId: PET, photoId: PHOTO, sceneIds: PET_ART_PHOTO_SCENE_IDS.slice(0, 10), idempotencyKey: "ten-payment-test" });
    expect(created.batch.items).toHaveLength(10);
    expect(created.batch.cost).toBe(12);
    expect(await balance()).toBe(88);
    const database = await getDatabase();
    expect((await getArtPhotoBundle(USER, created.batch.id)).status).toBe("queued");
    expect(await database.query("SELECT id FROM ai_runs WHERE idempotency_key LIKE $1", [`art-bundle-${created.batch.id}-%`])).toHaveLength(10);
    expect(await database.query("SELECT id FROM growth_orders WHERE user_id=$1", [USER])).toHaveLength(0);
  });

  it("20 张套餐扣 20 颗，重复提交只扣一次，换场景视为冲突", async () => {
    const input = { package: "twenty", petId: PET, photoId: PHOTO, sceneIds: PET_ART_PHOTO_SCENE_IDS.slice(0, 20), idempotencyKey: "twenty-repeat-request" };
    const first = await createArtPhotoBundle(USER, input);
    const repeated = await createArtPhotoBundle(USER, input);
    expect(repeated.batch.id).toBe(first.batch.id);
    expect(await balance()).toBe(80);
    await expect(createArtPhotoBundle(USER, { ...input, sceneIds: [...input.sceneIds].reverse() })).rejects.toMatchObject({ code: "ART_PHOTO_REQUEST_CONFLICT" });
    expect(await (await getDatabase()).query("SELECT id FROM ai_runs WHERE idempotency_key LIKE $1", [`art-bundle-${first.batch.id}-%`])).toHaveLength(20);
  });

  it("余额不足时整体回滚：不留批次、不入队", async () => {
    const database = await getDatabase();
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Bo','dog','unknown','birthday','active',true,now())", ["00000000-0000-4000-8000-000000000085", OTHER]);
    await database.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,'bo.png','image/png',1,$4,0,'clear',now())", ["00000000-0000-4000-8000-000000000086", OTHER, "00000000-0000-4000-8000-000000000085", `private/${OTHER}/photos/bo.png`]);
    const error = await createArtPhotoBundle(OTHER, { package: "ten", petId: "00000000-0000-4000-8000-000000000085", photoId: "00000000-0000-4000-8000-000000000086", sceneIds: PET_ART_PHOTO_SCENE_IDS.slice(0, 10), idempotencyKey: "other-no-money-2" }).catch((caught) => caught);
    expect(error).toMatchObject({ code: "WALLET_INSUFFICIENT", details: { required: 12, balance: 0, shortfall: 12 } });
    expect(await database.query("SELECT id FROM art_photo_batches WHERE user_id=$1", [OTHER])).toHaveLength(0);
    expect(await database.query("SELECT id FROM ai_runs WHERE user_id=$1", [OTHER])).toHaveLength(0);
  });

  it("队列逐张生成、成片仅本人可读；批次取消后撤销读取", async () => {
    const { created } = await createAndPay("ten", "ten-worker-success");
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const batch = await getArtPhotoBundle(USER, created.batch.id);
    expect(batch).toMatchObject({ status: "processing", completedCount: 1, totalCount: 10 });
    const first = batch.items[0];
    expect(first.status).toBe("succeeded");
    expect((await request(batch.id, first.id, USER, true)).status).toBe(200);
    expect((await request(batch.id, first.id, OTHER)).status).toBe(404);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "art-photo-bundle-route-test-secret-over-32-characters");
    expect((await request(batch.id, first.id)).status).toBe(401);
    vi.stubEnv("NODE_ENV", "test");
    await cancelArtPhotoBundle(await getDatabase(), batch.id);
    expect((await getArtPhotoBundle(USER, batch.id)).status).toBe("cancelled");
    expect((await request(batch.id, first.id, USER)).status).toBe(403);
    expect((await (await getDatabase()).query("SELECT id FROM ai_runs WHERE status='queued' AND idempotency_key LIKE $1", [`art-bundle-${batch.id}-%`])).length).toBe(0);
  });

  it("单项失败自动重试，其他场景继续制作；租约过期后可恢复", async () => {
    const { created } = await createAndPay("ten", "ten-worker-recovery");
    const database = await getDatabase();
    const first = (await database.query("SELECT i.id item_id,i.run_id FROM art_photo_batch_items i WHERE i.batch_id=$1 ORDER BY position LIMIT 1", [created.batch.id]))[0];
    await database.query("UPDATE ai_runs SET status='processing',attempt=1,locked_at=now()-interval '20 minutes' WHERE id=$1", [first.run_id]);
    await database.query("UPDATE art_photo_batch_items SET status='processing',attempt=1 WHERE id=$1", [first.item_id]);
    await database.query("UPDATE ai_provider_slots SET run_id=$1,attempt=1,lease_until=now()-interval '1 minute' WHERE slot_id=1", [first.run_id]);
    await database.query("UPDATE ai_runs SET available_at=now()+interval '1 hour' WHERE id<>$1 AND idempotency_key LIKE $2", [first.run_id, `art-bundle-${created.batch.id}-%`]);
    expect((await processNextAiRun())?.status).toBe("succeeded");
    expect((await database.query("SELECT attempt,status FROM ai_runs WHERE id=$1", [first.run_id]))[0]).toMatchObject({ attempt: 2, status: "succeeded" });
    await database.query("UPDATE ai_runs SET available_at=now() WHERE idempotency_key LIKE $1 AND status='queued'", [`art-bundle-${created.batch.id}-%`]);
    await objectStorage.delete(PHOTO_KEY);
    expect((await processNextAiRun())?.status).toBe("retrying");
    await objectStorage.put(PHOTO_KEY, PNG, "image/png");
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const batch = await getArtPhotoBundle(USER, created.batch.id);
    expect(batch.completedCount).toBe(2);
    expect(batch.items.filter((item) => item.status === "queued")).toHaveLength(8);
  });

  it("唯一供应商槽被占用时等待，不会把其余 9 张同时发给供应商", async () => {
    vi.stubEnv("AI_MAX_CONCURRENCY", "1");
    const { created } = await createAndPay("ten", "ten-capacity-limit");
    const database = await getDatabase();
    const first = (await database.query("SELECT id,run_id FROM art_photo_batch_items WHERE batch_id=$1 ORDER BY position LIMIT 1", [created.batch.id]))[0];
    await database.query("UPDATE ai_runs SET status='processing',attempt=1,locked_at=now() WHERE id=$1", [first.run_id]);
    await database.query("UPDATE art_photo_batch_items SET status='processing',attempt=1 WHERE id=$1", [first.id]);
    await database.query("UPDATE ai_provider_slots SET run_id=$1,attempt=1,lease_until=now()+interval '15 minutes' WHERE slot_id=1", [first.run_id]);

    expect(await processNextAiRun()).toBeNull();
    expect((await database.query("SELECT id FROM ai_runs WHERE status='queued' AND idempotency_key LIKE $1", [`art-bundle-${created.batch.id}-%`]))).toHaveLength(9);

    await database.query("UPDATE ai_provider_slots SET run_id=NULL,attempt=NULL,lease_until=NULL WHERE slot_id=1");
    await database.query("UPDATE ai_runs SET status='queued' WHERE id=$1", [first.run_id]);
    await database.query("UPDATE art_photo_batch_items SET status='queued' WHERE id=$1", [first.id]);
    expect((await processNextAiRun())?.status).toBe("succeeded");
    expect((await getArtPhotoBundle(USER, created.batch.id)).completedCount).toBe(1);
  });

  it("同一套场景重试耗尽后标记失败，其余场景仍能继续完成", async () => {
    const { created } = await createAndPay("ten", "ten-failure-isolation");
    const database = await getDatabase();
    await objectStorage.delete(PHOTO_KEY);
    const retry = await processNextAiRun();
    expect(retry?.status).toBe("retrying");
    await database.query("UPDATE ai_runs SET available_at=now()+interval '1 hour' WHERE id<>$1 AND idempotency_key LIKE $2", [retry?.id, `art-bundle-${created.batch.id}-%`]);
    // 系统自动重试 2 次（共 3 次尝试）后才进入终态失败。
    await database.query("UPDATE ai_runs SET available_at=now() WHERE id=$1", [retry?.id]);
    expect((await processNextAiRun())?.status).toBe("retrying");
    await database.query("UPDATE ai_runs SET available_at=now() WHERE id=$1", [retry?.id]);
    const before = await balance();
    expect((await processNextAiRun())?.status).toBe("failed");
    // 失败的这一张按张退 1 颗。
    expect(await balance()).toBe(before + 1);
    await objectStorage.put(PHOTO_KEY, PNG, "image/png");
    await database.query("UPDATE ai_runs SET available_at=now() WHERE status='queued' AND idempotency_key LIKE $1", [`art-bundle-${created.batch.id}-%`]);
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const batch = await getArtPhotoBundle(USER, created.batch.id);
    expect(batch).toMatchObject({ status: "processing", failedCount: 1, completedCount: 1 });
    expect(batch.items.filter((item) => item.status === "queued")).toHaveLength(8);
  });
});
