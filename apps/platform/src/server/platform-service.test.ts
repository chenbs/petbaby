import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import sharp from "sharp";

import { photoInputSchema, type Work } from "@/domain/models";
import { AppError, routeError } from "@/server/errors";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { signSession, verifySession } from "@/server/auth/session";
import { resetDatabaseForTest, getDatabase } from "@/server/db/client";
import { inspectImage, objectStorage } from "@/server/storage";
import {
  canRegenerate,
  createGeneration,
  createOrder,
  createPet,
  getDeliveryPricing,
  unlockWork,
  getGeneration,
  getSharedWork,
  editWork,
  listPets,
  listPhotos,
  listWorks,
  revokeShare,
  savePhoto,
  shareWork,
  restoreWorkVersion,
  getDownload,
} from "@/server/platform-service";
import { runWorkerUntilIdle } from "@/server/worker/generation-worker";
import { assertGenerationCircuit, enforceRateLimit } from "@/server/risk/controls";
import { cleanupExpiredContent, closeExpiredOrders, healthSnapshot } from "@/server/maintenance";
import { listRuntimePlugins, listRuntimePluginVersions, rollbackRuntimePlugin, updateRuntimePlugin } from "@/plugins/runtime";
import { getWallet, listWalletLedger } from "@/server/wallet/service";
import { fundWallet } from "@/server/wallet/test-helpers";
import { getUserStatus } from "@/server/user-status-service";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));

async function seedUser(userId: string) {
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,$2) ON CONFLICT DO NOTHING", [userId, new Date()]);
}

/**
 * 默认用 **付费** 玩法（电影海报 5 颗冻干）建任务。新人礼 3 颗不够，先补 2 颗，扣完余额为 0。
 *
 * 2026-08-03 起 `pet-id-card` 转免费（改造方案 C6：证件照的免费替代太密，
 * 9.9 撑不住竞争），免费玩法的作品以 `locked=false` 入库、不建订单 ——
 * 用它测解锁/退款链路会一路测不到付费分支。
 * 免费路径另有 `免费玩法` 那一组用例专门覆盖。
 */
async function setupGeneration(userId = USER_A, key = "request-key-0001", pluginId = "pet-movie-poster") {
  await seedUser(userId);
  const pet = await createPet(userId, { name: "年糕", species: "cat", gender: "unknown", birthday: "" });
  const storageKey = `private/${userId}/${crypto.randomUUID()}.png`;
  await objectStorage.put(storageKey, PNG, "image/png");
  const photo = await savePhoto(userId, { petId: pet.id, filename: "pet.png", mimeType: "image/png", size: PNG.byteLength, storageKey });
  await fundWallet(userId, 2);
  const task = await createGeneration(userId, { pluginId, petId: pet.id, photoIds: [photo.id], idempotencyKey: key });
  return { pet, photo, task };
}

describe("persistent platform service", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    vi.unstubAllEnvs();
  });

  it("persists pets and isolates records by user", async () => {
    await seedUser(USER_A); await seedUser(USER_B);
    const pet = await createPet(USER_A, { name: " 年糕 ", species: "cat", gender: "unknown", birthday: "" });
    expect(pet.name).toBe("年糕");
    expect((await listPets(USER_A))).toHaveLength(1);
    expect((await listPets(USER_B))).toHaveLength(0);
  });

  /**
   * 拍摄时间是成长时间线/去年今日/叙事视频的排序与日期来源。
   * 两条都要成立：EXIF 有值时原样落库，没有 EXIF 时列留 NULL 但读出来回落到
   * 上传时间 —— 回落只在读取侧，这样两类照片在库里仍可区分（shotAtSource）。
   */
  it("savePhoto 落 shot_at，无 EXIF 时读取回落到上传时间", async () => {
    await seedUser(USER_A);
    const pet = await createPet(USER_A, { name: "年糕", species: "cat", gender: "unknown", birthday: "" });
    const database = await getDatabase();

    const withExifKey = `private/${USER_A}/${crypto.randomUUID()}.png`;
    await objectStorage.put(withExifKey, PNG, "image/png");
    const shotAt = new Date("2025-02-03T06:30:05.000Z");
    const shot = await savePhoto(USER_A, { petId: pet.id, filename: "shot.png", mimeType: "image/png", size: PNG.byteLength, storageKey: withExifKey, shotAt });
    expect(shot.shotAt).toBe(shotAt.toISOString());
    expect(shot.shotAtSource).toBe("exif");

    const withoutExifKey = `private/${USER_A}/${crypto.randomUUID()}.png`;
    await objectStorage.put(withoutExifKey, PNG, "image/png");
    const screenshot = await savePhoto(USER_A, { petId: pet.id, filename: "screenshot.png", mimeType: "image/png", size: PNG.byteLength, storageKey: withoutExifKey });
    const rows = await database.query<{ shot_at: unknown }>("SELECT shot_at FROM photos WHERE id=$1", [screenshot.id]);
    expect(rows[0].shot_at).toBeNull();
    expect(screenshot.shotAt).toBe(screenshot.createdAt);
    expect(screenshot.shotAtSource).toBe("upload");
  });

  /**
   * 方案 E 的统计条读这三个计数。用真库跑而不是断言 SQL 字符串：
   * 要验的正是「三个 LEFT JOIN 子查询不会互相放大计数」——
   * 一只宠物同时有多张照片和多个作品时，写成多表 JOIN 会得到乘积。
   */
  it("listPets 附带作品/照片/纪念计数，且多照片多作品不会互相放大", async () => {
    const { pet, photo } = await setupGeneration();
    const extraKey = `private/${USER_A}/${crypto.randomUUID()}.png`;
    await objectStorage.put(extraKey, PNG, "image/png");
    await savePhoto(USER_A, { petId: pet.id, filename: "second.png", mimeType: "image/png", size: PNG.byteLength, storageKey: extraKey });
    await runWorkerUntilIdle();

    const database = await getDatabase();
    const workRows = await database.query<{ count: string }>("SELECT COUNT(*) AS count FROM works WHERE pet_id=$1", [pet.id]);
    const works = Number(workRows[0].count);
    expect(works).toBeGreaterThan(0);

    const [listed] = await listPets(USER_A);
    // 3 张照片：setupGeneration 建 1 张 + 这里 1 张，作品产出图不进 photos 表
    expect(listed.counts).toEqual({ works, photos: 2, memorials: 0 });
    expect(photo.petId).toBe(pet.id);
  });

  it("listPets 对没有任何关联数据的宠物返回 0 而不是缺字段", async () => {
    await seedUser(USER_A);
    await createPet(USER_A, { name: "新来的", species: "dog", gender: "unknown", birthday: "" });
    const [listed] = await listPets(USER_A);
    expect(listed.counts).toEqual({ works: 0, photos: 0, memorials: 0 });
  });

  it("keeps idempotent tasks and limits free plugins to ten a day", async () => {
    const first = await setupGeneration();
    const repeated = await createGeneration(USER_A, { pluginId: "pet-movie-poster", petId: first.pet.id, photoIds: [first.photo.id], idempotencyKey: "request-key-0001" });
    expect(repeated.id).toBe(first.task.id);
    // 新人礼 3 颗 + 补 2 颗，扣了 5 颗；重复提交不重复扣。
    expect((await getWallet(USER_A)).balance).toBe(0);
    for (let index = 0; index < 10; index += 1) {
      await createGeneration(USER_A, { pluginId: "pet-id-card", petId: first.pet.id, photoIds: [first.photo.id], idempotencyKey: `free-card-${index}-key` });
    }
    await expect(createGeneration(USER_A, { pluginId: "pet-id-card", petId: first.pet.id, photoIds: [first.photo.id], idempotencyKey: "free-card-over-key" })).rejects.toThrow("今天的免费生成已用完 10 次");
  });

  it("grants the newcomer gift once per account and records it in the ledger", async () => {
    await seedUser(USER_A);
    const pet = await createPet(USER_A, { name: "阿福", species: "dog", gender: "unknown", birthday: "" });
    expect((pet as { newcomerGift?: { units: number } }).newcomerGift).toEqual({ units: 3 });
    await createPet(USER_A, { name: "二福", species: "dog", gender: "unknown", birthday: "" });
    const wallet = await getWallet(USER_A);
    expect(wallet).toMatchObject({ balance: 3, giftBalance: 3, newcomerGiftGranted: true, firstTopupAvailable: true });
    expect(wallet.nextGiftExpiry?.units).toBe(3);
    expect((await listWalletLedger(USER_A)).items.map((item) => item.title)).toEqual(["新人见面礼"]);
  });

  it("rejects a paid plugin when the balance is short and leaves no task behind", async () => {
    const { pet, photo } = await setupGeneration();
    const error = await createGeneration(USER_A, { pluginId: "pet-movie-poster", petId: pet.id, photoIds: [photo.id], idempotencyKey: "no-money-0001" }).catch((caught) => caught);
    expect(error).toMatchObject({ code: "WALLET_INSUFFICIENT", status: 402, details: { required: 5, balance: 0, shortfall: 5 } });
    const rows = await (await getDatabase()).query("SELECT id FROM generation_tasks WHERE idempotency_key='no-money-0001'");
    expect(rows).toHaveLength(0);
  });

  it("worker creates a durable work and the owner can share it", async () => {
    const { task } = await setupGeneration();
    expect((await getGeneration(USER_A, task.id)).status).toBe("queued");
    expect(await runWorkerUntilIdle()).toHaveLength(1);
    const completed = await getGeneration(USER_A, task.id);
    expect(completed.status).toBe("succeeded");
    // 先扣后做：付费玩法的作品入库即正式版。
    expect(completed.work?.locked).toBe(false);
    const shared = await shareWork(USER_A, completed.work!.id);
    const sharedWork = await getSharedWork(shared.token);
    expect(sharedWork.public).toBe(true);
    expect(sharedWork.outputUrl).toBe(`/api/share/${shared.token}/media/output`);
    await expect(listWorks(USER_B)).resolves.toHaveLength(0);
  });

  it("unlocks a legacy locked work once with dongan and retires cash orders", async () => {
    const { task } = await setupGeneration();
    await runWorkerUntilIdle();
    const work = (await getGeneration(USER_A, task.id)).work!;
    await expect(createOrder()).rejects.toMatchObject({ code: "ORDER_RETIRED", status: 410 });
    // 模拟冻干上线前遗留的锁定作品。
    await (await getDatabase()).query("UPDATE works SET locked=true WHERE id=$1", [work.id]);
    await fundWallet(USER_A, 10);
    const first = await unlockWork(USER_A, work.id);
    expect(first).toMatchObject({ charged: 5 });
    expect(first.work.locked).toBe(false);
    expect((await unlockWork(USER_A, work.id)).charged).toBe(0);
    expect((await getWallet(USER_A)).balance).toBe(5);
  });

  it("blocks cross-user resource access", async () => {
    const { task } = await setupGeneration();
    await seedUser(USER_B);
    await expect(getGeneration(USER_B, task.id)).rejects.toThrow("没有找到这条记录");
  });

  it("edits and regenerates by charging again, and revokes public sharing", async () => {
    const { task, pet, photo } = await setupGeneration();
    await fundWallet(USER_A, 10);
    await runWorkerUntilIdle();
    const work = (await getGeneration(USER_A, task.id)).work!;
    const edited = await editWork(USER_A, work.id, { title: "新标题", subtitle: "新文案" });
    expect(edited.title).toBe("新标题");
    // 重新生成必须用与原作品相同的玩法（SOURCE_WORK_MISMATCH 会拦住不一致的）。
    const second = await createGeneration(USER_A, { pluginId: "pet-movie-poster", petId: pet.id, photoIds: [photo.id], sourceWorkId: work.id, options: {}, idempotencyKey: "regenerate-0001" });
    await runWorkerUntilIdle();
    expect((await getGeneration(USER_A, second.id)).work?.version).toBe(3);
    // 扣一次生成一次：首次、改文案、重新生成各 5 颗。
    expect((await getWallet(USER_A)).balance).toBe(15 - 15);
    const shared = await shareWork(USER_A, work.id);
    await revokeShare(USER_A, work.id);
    await expect(getSharedWork(shared.token)).rejects.toThrow("分享已关闭");
  });

  it("generates movie poster and time album outputs", async () => {
    const { pet, photo } = await setupGeneration();
    await fundWallet(USER_A, 100);
    const database = await getDatabase();
    await database.exec("DELETE FROM generation_tasks; DELETE FROM daily_quotas;");
    const movie = await createGeneration(USER_A, { pluginId: "pet-movie-poster", petId: pet.id, photoIds: [photo.id], options: { style: "hongkong" }, idempotencyKey: "movie-0001" });
    await runWorkerUntilIdle();
    const movieWork = (await getGeneration(USER_A, movie.id)).work!;
    expect(movieWork.title).toContain("风云");
    const [movieFiles] = await database.query<{ output_key: string; preview_key: string }>("SELECT output_key,preview_key FROM works WHERE id=$1", [movieWork.id]);
    for (const key of [movieFiles.output_key, movieFiles.preview_key]) {
      const stored = await objectStorage.get(key);
      expect(stored).toBeTruthy();
      const metadata = await sharp(Buffer.from(stored!.body)).metadata();
      expect(Buffer.from(metadata.exif || []).toString("latin1")).toContain("AI-generated");
    }
    const photos = [photo];
    for (let index = 0; index < 5; index += 1) {
      const storageKey = `private/${USER_A}/${crypto.randomUUID()}.png`; await objectStorage.put(storageKey, PNG, "image/png");
      photos.push(await savePhoto(USER_A, { petId: pet.id, filename: `${index}.png`, mimeType: "image/png", size: PNG.byteLength, storageKey }));
    }
    await database.exec("DELETE FROM generation_tasks; DELETE FROM daily_quotas;");
    const album = await createGeneration(USER_A, { pluginId: "pet-time-album", petId: pet.id, photoIds: photos.map((item) => item.id), options: { voice: "owner" }, idempotencyKey: "album-0001" });
    await runWorkerUntilIdle();
    const albumWork = (await getGeneration(USER_A, album.id)).work!;
    expect(albumWork.outputUrl).toMatch(/\.png$/);
    expect(await listPhotos(USER_A, pet.id)).toHaveLength(6);
    // 6 张照片、跨度不足一年：画册基础档 18 颗。
    const pricing = await getDeliveryPricing(USER_A, pet.id, "pet-time-album");
    expect(pricing).toMatchObject({ cost: 18, tier: "basic", tierCosts: { basic: 18, advanced: 28, annual: 38 } });
  });

  it("refunds dongan in full when generation fails after the automatic retries", async () => {
    const { task } = await setupGeneration();
    const database = await getDatabase();
    await database.query("UPDATE generation_tasks SET plugin_snapshot=jsonb_set(plugin_snapshot,'{generator,template}','\"missing-generator\"') WHERE id=$1", [task.id]);
    expect((await getWallet(USER_A)).balance).toBe(0);
    for (let index = 0; index < 3; index += 1) {
      await database.query("UPDATE generation_tasks SET available_at=now() WHERE id=$1", [task.id]);
      await runWorkerUntilIdle(1);
    }
    const failed = await getGeneration(USER_A, task.id);
    expect(failed).toMatchObject({ status: "failed", attempt: 3 });
    expect((await getWallet(USER_A)).balance).toBe(5);
  });

  it("closes stale pending orders, including top-up orders", async () => {
    await seedUser(USER_A);
    const database = await getDatabase();
    await database.query("INSERT INTO growth_orders (id,user_id,kind,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'wallet_topup','fd-topup-38',38,'pending','{}',now()-interval '31 minutes',now())", [crypto.randomUUID(), USER_A]);
    expect(await closeExpiredOrders()).toBe(1);
  });

  it("enforces rate and cost circuits and reports health", async () => {
    await enforceRateLimit("test", USER_A, 1, 60);
    await expect(enforceRateLimit("test", USER_A, 1, 60)).rejects.toThrow("操作太频繁");
    const database = await getDatabase();
    await database.query("INSERT INTO system_usage (usage_date,generation_count,estimated_cost,circuit_open,updated_at) VALUES ($1,999,0,false,now())", [new Date().toISOString().slice(0,10)]);
    await expect(assertGenerationCircuit()).rejects.toThrow("今日生成额度已达上限");
    expect((await healthSnapshot()).database).toBe(true);
  });

  /*
   * 2026-09 起作品长期保存：维护任务不再按 expires_at 删除未付费作品。
   * 即使历史行还带着过期时间，作品和文件都必须留下。
   */
  it("keeps locked works even past their legacy expiry", async () => {
    const { task } = await setupGeneration(); await runWorkerUntilIdle();
    const work = (await getGeneration(USER_A, task.id)).work!;
    expect(work.expiresAt).toBeUndefined();
    const database = await getDatabase();
    await database.query("UPDATE works SET expires_at=now()-interval '1 day' WHERE id=$1", [work.id]);
    expect((await cleanupExpiredContent()).works).toBe(0);
    expect(await listWorks(USER_A)).toHaveLength(1);
    expect(await objectStorage.get(work.previewKey!)).toBeTruthy();
  });
});

describe("security boundaries", () => {
  it("validates image signatures and rejects MIME mismatch", () => {
    expect(inspectImage(PNG, "image/png")?.extension).toBe("png");
    expect(inspectImage(PNG, "image/jpeg")).toBeNull();
    expect(() => photoInputSchema.parse({ petId: "x", filename: "x", mimeType: "text/html", size: 1 })).toThrow();
  });

  it("signs bounded sessions and rejects tampering", () => {
    const token = signSession(USER_A);
    expect(verifySession(token)?.userId).toBe(USER_A);
    expect(verifySession(`${token}tampered`)).toBeNull();
  });

  it("rejects cross-site JSON mutations", () => {
    expect(() => assertTrustedMutation(new Request("https://app.example/api", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", host: "app.example" } }))).toThrow("拒绝跨站请求");
    expect(() => assertTrustedMutation(new Request("https://app.example/api", { method: "POST", headers: { "content-type": "text/plain", origin: "https://app.example", host: "app.example" } }))).toThrow("请求必须使用 JSON");
  });

  it("returns stable route errors without internal details", async () => {
    const validation = (() => { try { z.string().min(2).parse(""); } catch (error) { return error; } })();
    expect(routeError(validation).status).toBe(422);
    expect(routeError(new AppError("NO_QUOTA", "额度不足", 429)).status).toBe(429);
    const throttled = routeError(new AppError("RATE_LIMITED", "操作太频繁，请稍后再试", 429, 17));
    expect(throttled.headers.get("Retry-After")).toBe("17");
    expect((await throttled.json()).error.retryAfterSeconds).toBe(17);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = routeError(new Error("database secret"));
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
    spy.mockRestore();
  });

  it("limits free regeneration to 24 hours", () => {
    const work = { createdAt: "2026-07-17T08:00:00.000Z" } as Work;
    expect(canRegenerate(work, new Date("2026-07-18T07:59:59.000Z"))).toBe(true);
    expect(canRegenerate(work, new Date("2026-07-18T08:00:01.000Z"))).toBe(false);
  });

  it("stores stage-one asset and commercial snapshots", async () => {
    await resetDatabaseForTest();
    const { task, pet } = await setupGeneration();
    expect(pet.dateType).toBe("birthday");
    const database = await getDatabase();
    const taskRow = await database.query("SELECT plugin_snapshot FROM generation_tasks WHERE id=$1", [task.id]);
    expect(taskRow[0].plugin_snapshot).toBeTruthy();
    const options = (await database.query("SELECT options,wallet_biz_key FROM generation_tasks WHERE id=$1", [task.id]))[0];
    expect(options.wallet_biz_key).toBe(`spend:generation:${task.id}`);
    expect((options.options as { dongan?: { cost: number } }).dongan?.cost).toBe(5);
  });

  it("versions and rolls back runtime plugin configuration", async () => {
    await resetDatabaseForTest();
    await seedUser(USER_A);
    const plugin = (await listRuntimePlugins())[0];
    const updated = await updateRuntimePlugin(plugin.id, { ...plugin, tagline: "new tagline" }, USER_A);
    expect(updated.version).toBe(2);
    expect((await listRuntimePluginVersions(plugin.id))).toHaveLength(2);
    const rolledBack = await rollbackRuntimePlugin(plugin.id, 1, USER_A);
    expect(rolledBack.version).toBe(3);
    expect(rolledBack.manifest.tagline).toBe(plugin.tagline);
  });

  it("accepts PostgreSQL JSON fields returned as strings", async () => {
    await resetDatabaseForTest();
    const plugin = (await listRuntimePlugins())[0];
    const database = await getDatabase();
    await database.query("UPDATE plugin_configs SET manifest=$2::jsonb WHERE id=$1", [plugin.id, JSON.stringify(JSON.stringify(plugin))]);
    const decoded = (await listRuntimePlugins()).find((item) => item.id === plugin.id);
    expect(decoded).toEqual(plugin);
  });

  it("protects and expires share links and restores a work version", async () => {
    await resetDatabaseForTest();
    const { task } = await setupGeneration();
    await runWorkerUntilIdle();
    const work = (await getGeneration(USER_A, task.id)).work!;
    const shared = await shareWork(USER_A, work.id, { accessCode: "2468", expiresInHours: 1 });
    await expect(getSharedWork(shared.token)).rejects.toThrow();
    expect((await getSharedWork(shared.token, "2468")).public).toBe(true);
    const database = await getDatabase();
    const versions = await database.query("SELECT id FROM work_versions WHERE work_id=$1 ORDER BY version", [work.id]);
    expect(versions[0]).toBeTruthy();
    const restored = await restoreWorkVersion(USER_A, work.id, String(versions[0].id));
    expect(restored.version).toBe(2);
  });
});

/*
 * 免费玩法零摩擦（改造方案 C2）。
 *
 * 原先 `unlockPrice: 0` 的作品也以 locked=true 入库，用户必须点「解锁」、
 * 建一条 ¥0 订单、走一遍支付流程才能下载 —— 而 PL-23 的定位是「分享钩子」，
 * 钩子前面加一道支付流程，钩子就不成立了。这直接违反 14 号文的
 * 「积累不能有任何摩擦」。
 *
 * 放在单测而不是 E2E：免费额度每天 1 次且共用一个 demo 用户，
 * 第二个要生成的 E2E 用例必然撞上 DAILY_QUOTA_USED。
 */
describe("免费玩法", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    vi.unstubAllEnvs();
  });

  async function generateFree(pluginId = "pet-id-card") {
    await seedUser(USER_A);
    const pet = await createPet(USER_A, { name: "汤圆", species: "cat", gender: "unknown", birthday: "" });
    const storageKey = `private/${USER_A}/${crypto.randomUUID()}.png`;
    await objectStorage.put(storageKey, PNG, "image/png");
    const photo = await savePhoto(USER_A, { petId: pet.id, filename: "pet.png", mimeType: "image/png", size: PNG.byteLength, storageKey });
    const task = await createGeneration(USER_A, { pluginId, petId: pet.id, photoIds: [photo.id], idempotencyKey: "free-plugin-0001" });
    await runWorkerUntilIdle();
    return (await getGeneration(USER_A, task.id)).work!;
  }

  it("免费玩法的作品直接以 locked=false 入库", async () => {
    const work = await generateFree();
    expect(work.locked).toBe(false);
  });

  /** 未锁作品可以直接下载，不需要先建订单。 */
  it("免费作品可直接下载", async () => {
    const work = await generateFree();
    await expect(getDownload(USER_A, work.id, "image")).resolves.toMatchObject({ key: expect.any(String) });
    expect(work.outputKey).toMatch(/\.png$/);
    const image = await objectStorage.get(work.outputKey!);
    expect(image?.contentType).toBe("image/png");
    expect(await sharp(Buffer.from(image!.body)).metadata()).toMatchObject({ format: "png", width: 1080, height: 1440 });
  });

  /*
   * 微信支付 amount.total 最低 1 分，Math.round(0*100)=0 根本付不掉 ——
   * 建一条永远付不了的订单只会让用户卡在支付页。
   */
  it("免费作品无需解锁，也不扣冻干", async () => {
    const work = await generateFree();
    expect(await unlockWork(USER_A, work.id)).toMatchObject({ charged: 0 });
    expect((await getWallet(USER_A)).balance).toBe(3);
  });

  /*
   * 2026-09 起取消营销水印：免费玩法直接拿到干净的正式产物，
   * 预览只是缩小后的 PNG，不叠任何文字或小程序码。
   */
  it("免费作品的正式产物不被预览字节覆盖，预览是不带标记的缩图", async () => {
    const work = await generateFree();
    const output = await objectStorage.get(work.outputKey!);
    const preview = await objectStorage.get(work.previewKey!);
    expect(output).toBeTruthy();
    expect(preview).toBeTruthy();
    expect(Buffer.from(output!.body).equals(Buffer.from(preview!.body))).toBe(false);
    expect(new TextDecoder().decode(output!.body)).not.toContain("免费预览");
    const meta = await sharp(Buffer.from(preview!.body)).metadata();
    expect(meta.format).toBe("png");
    expect(Math.max(meta.width || 0, meta.height || 0)).toBeLessThanOrEqual(1080);
  });

  it("付费玩法先扣冻干，作品直接是正式版", async () => {
    await seedUser(USER_A);
    await fundWallet(USER_A, 4);
    const work = await generateFree("pet-movie-poster");
    expect(work.locked).toBe(false);
    // 新人礼 3 颗 + 补 4 颗，海报扣 5 颗
    expect((await getWallet(USER_A)).balance).toBe(2);
  });

  it("免费玩法每天十次，重新生成也计次；付费与纪念册不占免费次数", async () => {
    const work = await generateFree();
    const photo = (await listPhotos(USER_A, work.petId))[0];
    for (let index = 1; index < 10; index += 1) {
      await createGeneration(USER_A, { pluginId: "pet-id-card", petId: work.petId, photoIds: [photo.id], sourceWorkId: work.id, idempotencyKey: `free-count-${index}` });
    }
    expect((await getUserStatus(USER_A)).quota).toMatchObject({ daily: 10, used: 10, remaining: 0 });
    await expect(createGeneration(USER_A, { pluginId: "pet-id-card", petId: work.petId, photoIds: [photo.id], sourceWorkId: work.id, idempotencyKey: "free-eleventh" })).rejects.toMatchObject({ code: "DAILY_QUOTA_USED" });
    await fundWallet(USER_A, 3);
    await createGeneration(USER_A, { pluginId: "pet-movie-poster", petId: work.petId, photoIds: [photo.id], idempotencyKey: "paid-after-ten" });
    await (await getDatabase()).query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [work.petId]);
    const albumPhotoIds = [photo.id];
    for (let index = 1; index < 6; index += 1) {
      const storageKey = `private/${USER_A}/${crypto.randomUUID()}.png`;
      await objectStorage.put(storageKey, PNG, "image/png");
      const albumPhoto = await savePhoto(USER_A, { petId: work.petId, filename: `album-${index}.png`, mimeType: "image/png", size: PNG.byteLength, storageKey });
      albumPhotoIds.push(albumPhoto.id);
    }
    await createGeneration(USER_A, { pluginId: "pet-time-album", petId: work.petId, photoIds: albumPhotoIds, idempotencyKey: "memorial-free-album" });
    expect((await getUserStatus(USER_A)).quota.used).toBe(10);
    // 新人礼 3 颗 + 补 3 颗，海报扣 5 颗，纪念画册免费
    expect((await getWallet(USER_A)).balance).toBe(1);
  });
});
