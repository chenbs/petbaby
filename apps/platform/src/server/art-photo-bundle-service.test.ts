import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readBundleImage } from "@/app/api/art-photo-bundles/[id]/items/[itemId]/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { PET_ART_PHOTO_SCENE_IDS } from "@/domain/pet-art-photo";
import { processNextAiRun } from "@/server/growth-service";
import { applyPaymentConfirmation, applyRefundedTotal, ensurePayment } from "@/server/payments/service";
import { activateArtPhotoBundle, ART_PHOTO_BUNDLE_PACKAGES, createArtPhotoBundle, getArtPhotoBundle } from "./art-photo-bundle-service";

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

async function createAndPay(packageMode: "ten" | "all", key: string) {
  const sceneIds = PET_ART_PHOTO_SCENE_IDS.slice(0, ART_PHOTO_BUNDLE_PACKAGES[packageMode].count);
  const created = await createArtPhotoBundle(USER, { package: packageMode, petId: PET, photoId: PHOTO, sceneIds, idempotencyKey: key });
  const payment = await ensurePayment(USER, "growth", created.order.id);
  await applyPaymentConfirmation(payment.id, { paid: true, transactionId: `dev-${key}` });
  return { created, payment };
}

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("PAYMENT_PROVIDER", "development");
  await resetDatabaseForTest();
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  await database.query("INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Milo','cat','unknown','birthday','active',true,now())", [PET, USER]);
  await database.query("INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,'milo.png','image/png',1,$4,0,'clear',now())", [PHOTO, USER, PET, PHOTO_KEY]);
  await objectStorage.put(PHOTO_KEY, PNG, "image/png");
});

describe("艺术写真套餐队列", () => {
  it("10 张套餐必须精确选择 10 个场景，并在支付确认事务内入队", async () => {
    const created = await createArtPhotoBundle(USER, { package: "ten", petId: PET, photoId: PHOTO, sceneIds: PET_ART_PHOTO_SCENE_IDS.slice(0, 10), idempotencyKey: "ten-payment-test" });
    expect(created.order).toMatchObject({ amount: 9.9, sku: "pet-art-photo-bundle-10", status: "pending" });
    expect(created.batch.items).toHaveLength(10);
    const payment = await ensurePayment(USER, "growth", created.order.id);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "dev-art-bundle" });
    const database = await getDatabase();
    const batch = await getArtPhotoBundle(USER, created.batch.id);
    expect(batch.status).toBe("queued");
    expect(await database.query("SELECT id FROM ai_runs WHERE idempotency_key LIKE $1", [`art-bundle-${created.batch.id}-%`])).toHaveLength(10);
    expect((await database.query("SELECT status FROM growth_orders WHERE id=$1", [created.order.id]))[0].status).toBe("paid");
  });

  it("激活是幂等的，重复支付通知不会重复创建生成任务", async () => {
    const created = await createArtPhotoBundle(USER, { package: "ten", petId: PET, photoId: PHOTO, sceneIds: PET_ART_PHOTO_SCENE_IDS.slice(0, 10), idempotencyKey: "ten-idempotent-test" });
    const database = await getDatabase();
    await activateArtPhotoBundle(database, USER, created.batch.id, created.order.id);
    await activateArtPhotoBundle(database, USER, created.batch.id, created.order.id);
    expect(await database.query("SELECT id FROM ai_runs WHERE user_id=$1", [USER])).toHaveLength(10);
  });

  it("全部 36 张套餐按固定价格入队，重复提交沿用同一订单", async () => {
    const input = { package: "all", petId: PET, photoId: PHOTO, sceneIds: PET_ART_PHOTO_SCENE_IDS, idempotencyKey: "all-repeat-request" };
    const first = await createArtPhotoBundle(USER, input);
    const repeated = await createArtPhotoBundle(USER, input);
    expect(first.order).toMatchObject({ amount: 26.9, sku: "pet-art-photo-bundle-36" });
    expect(repeated.batch.id).toBe(first.batch.id);
    expect(repeated.order.id).toBe(first.order.id);
    await expect(createArtPhotoBundle(USER, { ...input, sceneIds: [...input.sceneIds].reverse() })).rejects.toMatchObject({ code: "ART_PHOTO_REQUEST_CONFLICT" });
    const payment = await ensurePayment(USER, "growth", first.order.id);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "dev-all-repeat" });
    expect((await getArtPhotoBundle(USER, first.batch.id)).items).toHaveLength(36);
    expect(await (await getDatabase()).query("SELECT id FROM ai_runs WHERE idempotency_key LIKE $1", [`art-bundle-${first.batch.id}-%`])).toHaveLength(36);
  });

  it("队列逐张生成、预览仅供已付款本人读取，退款后立即撤销读取", async () => {
    const { created, payment } = await createAndPay("all", "all-worker-success");
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const batch = await getArtPhotoBundle(USER, created.batch.id);
    expect(batch).toMatchObject({ status: "processing", completedCount: 1, totalCount: 36 });
    const first = batch.items[0];
    expect(first.status).toBe("succeeded");
    expect((await request(batch.id, first.id, USER, true)).status).toBe(200);
    expect((await request(batch.id, first.id, OTHER)).status).toBe(404);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "art-photo-bundle-route-test-secret-over-32-characters");
    expect((await request(batch.id, first.id)).status).toBe(401);
    vi.stubEnv("NODE_ENV", "test");
    await applyRefundedTotal(payment.id, Math.round(ART_PHOTO_BUNDLE_PACKAGES.all.amount * 100));
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
    await database.query("UPDATE ai_runs SET available_at=now() WHERE id=$1", [retry?.id]);
    expect((await processNextAiRun())?.status).toBe("failed");
    await objectStorage.put(PHOTO_KEY, PNG, "image/png");
    await database.query("UPDATE ai_runs SET available_at=now() WHERE status='queued' AND idempotency_key LIKE $1", [`art-bundle-${created.batch.id}-%`]);
    expect((await processNextAiRun())?.status).toBe("succeeded");
    const batch = await getArtPhotoBundle(USER, created.batch.id);
    expect(batch).toMatchObject({ status: "processing", failedCount: 1, completedCount: 1 });
    expect(batch.items.filter((item) => item.status === "queued")).toHaveLength(8);
  });
});
