import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { describeEntitlements, singleBuyValue } from "@/domain/membership";
import {
  createAnnualReport,
  createAnnualReportUnlockOrder,
  createMembership,
  createPhysicalOrder,
  listMembershipPlans,
  listMemberships,
  payGrowthOrder,
} from "@/server/growth-service";
import {
  createGeneration,
  createOrder,
  createPet,
  getDeliveryPricing,
  getGeneration,
  savePhoto,
} from "@/server/platform-service";
import { objectStorage } from "@/server/storage";
import { runWorkerUntilIdle } from "@/server/worker/generation-worker";

/*
 * 权益兑付的端到端口径（改造项 M5）。
 *
 * 改造前有 346 个用例全绿，却漏掉了**全部**兑付路径：`pricing.test.ts` 测档位
 * 解析、`entitlements.test.ts` 测权益读取，两者都正确，而把它们接起来的那行
 * 三元表达式把「给最高规格」当成「按最高档计价」——会员比免费用户多付 ¥29.1。
 *
 * 所以这一组的口径是：**每项权益必须有一条「会员走完整链路真的拿到它」的用例**，
 * 断言落在最终结果（订单金额、locked 状态、账本行）上，不落在中间函数的返回值。
 * 测函数不测权益，就是上一轮漏掉这个缺陷的原因。
 */

const MEMBER = "00000000-0000-4000-8000-0000000000f1";
const FREE = "00000000-0000-4000-8000-0000000000f2";
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZQAAAAASUVORK5CYII=", "base64"),
);

async function seedUsers() {
  const database = await getDatabase();
  for (const id of [MEMBER, FREE]) {
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()) ON CONFLICT DO NOTHING", [id]);
  }
}

/**
 * 走**完整购买链路**开通会员：createMembership 建单 → payGrowthOrder 支付激活。
 *
 * 刻意不直接 INSERT 一条 active 的 memberships 行：那样会跳过
 * `payGrowthOrder` 里的激活分支，而权益能不能兑付恰恰取决于那一步有没有
 * 把 status 置成 active、有没有把 entitlements 快照带过来。
 * 「用户付了钱之后拿到什么」是这一组要验的全部内容。
 */
async function buyMembership(userId: string) {
  const membership = await createMembership(userId, { plan: "yearly" });
  await payGrowthOrder(userId, String(membership.orderId));
  return membership;
}

async function addPhoto(userId: string, petId: string, shotAt: string) {
  const key = `private/${userId}/${crypto.randomUUID()}.png`;
  await objectStorage.put(key, PNG, "image/png");
  const photo = await savePhoto(userId, { petId, filename: "p.png", mimeType: "image/png", size: PNG.byteLength, storageKey: key });
  await (await getDatabase()).query("UPDATE photos SET shot_at=$2 WHERE id=$1", [photo.id, new Date(shotAt)]);
  return photo;
}

/**
 * 造一本画册作品。`photoCount` 与 `spanDays` 决定这只宠物的积累档位。
 *
 * `key` 会被补成至少 8 字符：`generationInputSchema` 对 idempotencyKey 有
 * `min(8)`，短了会以 ZodError 失败 —— 而那个报错跟被测的权益逻辑毫无关系。
 */
async function makeAlbum(userId: string, options: { photoCount: number; spanDays: number; key: string }) {
  const pet = await createPet(userId, { name: "年糕", species: "cat", gender: "unknown", birthday: "", lifeStage: "active" });
  const photos = [];
  for (let index = 0; index < options.photoCount; index += 1) {
    const offset = options.photoCount > 1 ? Math.round((options.spanDays * index) / (options.photoCount - 1)) : 0;
    photos.push(await addPhoto(userId, pet.id, new Date(Date.UTC(2025, 0, 1 + offset, 8)).toISOString()));
  }
  const task = await createGeneration(userId, {
    pluginId: "pet-time-album",
    petId: pet.id,
    photoIds: photos.slice(0, 6).map((photo) => photo.id),
    idempotencyKey: options.key.padEnd(8, "0"),
  });
  await runWorkerUntilIdle();
  return { pet, work: (await getGeneration(userId, task.id)).work! };
}

describe("在售套餐的权益必须可兑付（M2）", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seedUsers();
  });

  /*
   * 健康两项已随第三批（L1/L2）实施并由 P5 加回（迁移 0023）。
   *
   * 这条用例的**不变式没变**：在售套餐里的每一项权益都必须有兑付代码。
   * 变的只是「哪些算已实现」—— 所以下面那条清单式守卫（用
   * describeEntitlements 当白名单）才是真正的防线，它不需要随批次改。
   */
  it("在售套餐含健康权益且都可兑付", async () => {
    const plans = await listMembershipPlans();
    expect(plans.length).toBeGreaterThan(0);
    const yearly = plans.find((plan) => plan.plan === "yearly")!;
    expect(yearly.entitlements.healthExportUnlimited).toBe(true);
    expect(yearly.entitlements.annualHealthReport).toBe(1);
    // 兑付链路见 server/health/document.test.ts（无权益拒绝、会员无限、按次用完回落）
    expect(yearly.benefits.map((benefit) => benefit.key)).toContain("healthExportUnlimited");
    expect(yearly.benefits.map((benefit) => benefit.key)).toContain("annualHealthReport");
  });

  /** 月度会员在迁移 0020 已下架，不该还能被买到。 */
  it("月度会员不在售", async () => {
    expect((await listMembershipPlans()).map((plan) => plan.plan)).not.toContain("monthly");
    await expect(createMembership(MEMBER, { plan: "monthly" })).rejects.toMatchObject({ code: "MEMBERSHIP_PLAN_UNAVAILABLE" });
  });

  /*
   * P5 恢复 ¥128（迁移 0023）：A5/A6 已实施，两项健康权益加回。
   * 0021 的 ¥69 版本转 inactive 但保留 —— 已购用户按当时的快照履约到期。
   */
  it("年度会员按 0023 的 ¥128 在售", async () => {
    const yearly = (await listMembershipPlans()).find((plan) => plan.plan === "yearly");
    expect(yearly?.amount).toBe(128);
    expect(yearly?.entitlements).toEqual({ tierUnlock: true, healthExportUnlimited: true, annualHealthReport: 1, annualReport: 1, physicalDiscount: 0.9 });
    // 同 code 只输出最高 version，避免「列表展示 v3 的价、下单扣 v4 的钱」
    expect(yearly?.version).toBe(4);
  });

  /*
   * **每一项在售权益都要有兑付代码。** 这条用例是清单式的守卫：
   * 未来往权益 JSON 里加一项而忘了写兑付，它会立刻失败。
   * 判据是「该权益能被 describeEntitlements 描述出来」—— 那个函数
   * 只描述已实现兑付的权益，所以它同时是兑付能力的白名单。
   */
  it("在售权益逐项都能被描述（即都有兑付实现）", async () => {
    for (const plan of await listMembershipPlans()) {
      const described = describeEntitlements(plan.entitlements).map((benefit) => benefit.key);
      const sold = Object.entries(plan.entitlements)
        .filter(([, value]) => value !== undefined && value !== false && value !== 0)
        .map(([key]) => key);
      expect([...sold].sort()).toEqual([...described].sort());
    }
  });

  /*
   * 后台的 `ensureBusinessCatalogs` 种子必须是 inactive。
   *
   * 原实现以 `status='active'` 插入月度会员，而 `createMembership` 查的正是
   * status='active' —— 一次后台访问就能把月度会员重新上架，抵消迁移 0020/0021
   * 的下架动作。这个坑只在「先跑迁移、再有人打开后台」的顺序下出现，
   * 而那正是真实的使用顺序。
   */
  it("后台种子不会把已下架套餐重新上架", async () => {
    const { GET } = await import("@/app/api/admin/business/route");
    await GET(new Request("http://localhost/api/admin/business?section=memberships"));
    expect((await listMembershipPlans()).map((plan) => plan.plan)).not.toContain("monthly");
    await expect(createMembership(MEMBER, { plan: "monthly" })).rejects.toMatchObject({ code: "MEMBERSHIP_PLAN_UNAVAILABLE" });
  });

  /*
   * 「省多少」这句话只能在真的省了的时候说。
   *
   * 按「只做一件交付物」的保守口径，¥69 会员的权益值 ¥49（一次档差 29.1 +
   * 年报 19.9）—— 低于定价。所以 `saving` 必须为 0，改口给「做几件回本」：
   * 那是用户能自己验证的事实，而「省 ¥N」在他只做一件时是假的。
   */
  /*
   * 「省多少」这句话只能在真的省了的时候说。
   *
   * ¥128 版本的一次性权益合计 ¥118.8（档差 29.1 + 健康导出 29.9 +
   * 年度健康记录 39.9 + 年报 19.9）—— 仍低于定价，所以 `saving` 必须为 0，
   * 改口给「做几件回本」。这条不变式与 ¥69 时期完全一样，只是数字变了。
   */
  it("省额为负时不宣称省钱，改给回本件数", async () => {
    const yearly = (await listMembershipPlans()).find((plan) => plan.plan === "yearly")!;
    expect(singleBuyValue(yearly.entitlements)).toBe(118.8);
    expect(yearly.saving).toBe(0);
    // ¥128 − 一次性权益 89.7 = 38.3，每件省 29.1 ⇒ 两件回本。
    expect(yearly.breakEven).toBe(2);
  });
});

describe("tierUnlock 兑付（M1）", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seedUsers();
  });

  /*
   * **这是原缺陷的回归用例。** 改造前：10 张照片的会员付 ¥49，
   * 同样照片数的免费用户付 ¥19.9 —— 会员多付 ¥29.1。
   *
   * 两个用户各造一本同样积累量的画册，比较最终订单金额。
   * 断言必须是「会员 ≤ 免费」这个不变式而不是具体数字：
   * 价目表将来会调，而「会员不得更贵」永远成立。
   */
  it("同等积累下会员不比免费用户贵", async () => {
    await buyMembership(MEMBER);
    const memberAlbum = await makeAlbum(MEMBER, { photoCount: 10, spanDays: 30, key: "m1-member" });
    const freeAlbum = await makeAlbum(FREE, { photoCount: 10, spanDays: 30, key: "m1-free" });
    const memberOrder = await createOrder(MEMBER, memberAlbum.work.id);
    const freeOrder = await createOrder(FREE, freeAlbum.work.id);
    expect(memberOrder.amount).toBeLessThanOrEqual(freeOrder.amount);
    expect(memberOrder.amount).toBe(19.9);
  }, 90_000);

  /** 高积累会员：免费用户此时是 ¥49，会员仍按最低档 ¥19.9。 */
  it("高积累会员按最低档计价，省下档差", async () => {
    await buyMembership(MEMBER);
    const memberAlbum = await makeAlbum(MEMBER, { photoCount: 8, spanDays: 400, key: "m1-member-annual" });
    const freeAlbum = await makeAlbum(FREE, { photoCount: 8, spanDays: 400, key: "m1-free-annual" });
    expect((await createOrder(FREE, freeAlbum.work.id)).amount).toBe(49);
    const memberOrder = await createOrder(MEMBER, memberAlbum.work.id);
    expect(memberOrder.amount).toBe(19.9);
    // 省额随订单落库，供后台对账解释「为什么这单只收了 19.9」。
    expect(memberOrder.entitlements.memberSaving).toBeCloseTo(29.1, 2);
    expect(memberOrder.entitlements.listPrice).toBe(49);
  }, 90_000);

  /*
   * 「用最高规格、付最低价」的另一半：**规格**必须是最高档。
   * 只验价格会让「把会员一律降到 basic 规格」也通过，那是另一种毁约。
   */
  it("会员的交付物规格是最高档", async () => {
    await buyMembership(MEMBER);
    const { work, pet } = await makeAlbum(MEMBER, { photoCount: 10, spanDays: 30, key: "m1-spec" });
    await createOrder(MEMBER, work.id);
    const database = await getDatabase();
    const rows = await database.query("SELECT accumulation_snapshot FROM works WHERE id=$1", [work.id]);
    const snapshot = rows[0].accumulation_snapshot as Record<string, unknown>;
    expect(snapshot.tier).toBe("annual");
    expect(snapshot.priceTier).toBe("basic");
    // 下单前的展示口径与落库一致 —— 展示便宜、实收更贵正是 L3 要消除的风险。
    const pricing = await getDeliveryPricing(MEMBER, pet.id, "pet-time-album");
    expect(pricing.specTier).toBe("annual");
    expect(pricing.amount).toBe(19.9);
    expect(pricing.memberSaving).toBeCloseTo(29.1, 2);
  }, 90_000);

  /*
   * 会员对**不分档**的路径没有折扣：纪念形态统一价，
   * 「照片少所以便宜」在纪念语境下不成立。
   */
  it("纪念形态不因会员而降价", async () => {
    await buyMembership(MEMBER);
    const pet = await createPet(MEMBER, { name: "年糕", species: "cat", gender: "unknown", birthday: "", lifeStage: "memorial" });
    const photos = [];
    for (let index = 0; index < 6; index += 1) photos.push(await addPhoto(MEMBER, pet.id, `2025-03-0${index + 1}T08:00:00Z`));
    const task = await createGeneration(MEMBER, { pluginId: "pet-time-album", petId: pet.id, photoIds: photos.map((photo) => photo.id), idempotencyKey: "m1-memorial" });
    await runWorkerUntilIdle();
    const work = (await getGeneration(MEMBER, task.id)).work!;
    expect((await createOrder(MEMBER, work.id)).amount).toBe(49);
  }, 90_000);

  /** 未支付的会员拿不到权益 —— 建单即生效会让不付款也能白拿。 */
  it("未支付的会员不享折扣", async () => {
    await createMembership(MEMBER, { plan: "yearly" }); // 建单但不支付
    const { work } = await makeAlbum(MEMBER, { photoCount: 8, spanDays: 400, key: "m1-unpaid" });
    expect((await createOrder(MEMBER, work.id)).amount).toBe(49);
  }, 90_000);
});

describe("annualReport 兑付（M4）", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seedUsers();
  });

  async function makeReport(userId: string) {
    const pet = await createPet(userId, { name: "年糕", species: "cat", gender: "unknown", birthday: "" });
    await addPhoto(userId, pet.id, "2026-03-01T08:00:00Z");
    return createAnnualReport(userId, 2026);
  }

  /*
   * 付了会员（权益含「年度报告 ×1」）的用户不该再付 ¥19.9。
   * 断言落在**locked 状态**上而不是返回值：真正要保证的是他能拿到高清版。
   */
  it("会员直接解锁年报，不建订单", async () => {
    await buyMembership(MEMBER);
    const report = await makeReport(MEMBER);
    const result = await createAnnualReportUnlockOrder(MEMBER, report.id);
    expect(result).toMatchObject({ unlocked: true, viaEntitlement: true });
    const database = await getDatabase();
    expect((await database.query("SELECT locked FROM annual_reports WHERE id=$1", [report.id]))[0].locked).toBe(false);
    // 不该留下一张永远 pending 的订单。
    expect(await database.query("SELECT id FROM growth_orders WHERE resource_id=$1 AND kind='annual_report'", [report.id])).toHaveLength(0);
  }, 90_000);

  it("核销写进权益账本，余量随之减少", async () => {
    await buyMembership(MEMBER);
    expect((await listMemberships(MEMBER))[0].annualReportRemaining).toBe(1);
    const report = await makeReport(MEMBER);
    await createAnnualReportUnlockOrder(MEMBER, report.id);
    const database = await getDatabase();
    const ledger = await database.query("SELECT kind,units,status FROM entitlement_ledger WHERE user_id=$1 AND kind='annual_report'", [MEMBER]);
    expect(ledger).toHaveLength(1);
    expect(String(ledger[0].status)).toBe("consumed");
    expect((await listMemberships(MEMBER))[0].annualReportRemaining).toBe(0);
  }, 90_000);

  /*
   * 权益是 ×1，第二份年报要回落付费路径 ——
   * 无限兑付等于把「年度报告 ×1」当成了「无限」。
   */
  it("余量用完后回落付费路径", async () => {
    await buyMembership(MEMBER);
    const first = await makeReport(MEMBER);
    await createAnnualReportUnlockOrder(MEMBER, first.id);
    // 同一年的报告是 UPSERT（UNIQUE(user_id,year)），换一年拿第二份。
    const second = await createAnnualReport(MEMBER, 2025);
    const result = await createAnnualReportUnlockOrder(MEMBER, second.id);
    expect(result).toMatchObject({ status: "pending", amount: 19.9 });
    const database = await getDatabase();
    expect((await database.query("SELECT locked FROM annual_reports WHERE id=$1", [second.id]))[0].locked).toBe(true);
  }, 90_000);

  it("非会员照常走 ¥19.9 付费解锁", async () => {
    const report = await makeReport(FREE);
    const result = await createAnnualReportUnlockOrder(FREE, report.id);
    expect(result).toMatchObject({ status: "pending", amount: 19.9 });
    expect(await (await getDatabase()).query("SELECT id FROM entitlement_ledger WHERE user_id=$1 AND kind='annual_report'", [FREE])).toHaveLength(0);
  }, 90_000);
});

describe("physicalDiscount 兑付（M6）", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seedUsers();
  });

  async function unlockedWork(userId: string) {
    const pet = await createPet(userId, { name: "年糕", species: "cat", gender: "unknown", birthday: "" });
    const photo = await addPhoto(userId, pet.id, "2026-03-01T08:00:00Z");
    const database = await getDatabase();
    const workId = crypto.randomUUID();
    const outputKey = `private/${userId}/works/${workId}.svg`;
    await objectStorage.put(outputKey, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"></svg>'), "image/svg+xml");
    await database.query(
      "INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,asset_kind,locked,public,version,created_at) VALUES ($1,$2,'pet-id-card',$3,$4,'x','x','x','x',$5,'image',false,false,1,now())",
      [workId, userId, pet.id, photo.id, outputKey],
    );
    return workId;
  }

  const ADDRESS = { name: "张三", phone: "13800000000", province: "上海", city: "上海", detail: "测试路 1 号" };

  it("会员按九折下单，原价随行", async () => {
    await buyMembership(MEMBER);
    const order = await createPhysicalOrder(MEMBER, { workId: await unlockedWork(MEMBER), sku: "art-print-a4", address: ADDRESS });
    // 39.9 × 0.9 = 35.91。浮点直乘会得到 35.910000000000004，必须取整到分。
    expect(order.amount).toBe(35.91);
    expect(order.listPrice).toBe(39.9);
    expect(order.memberDiscount).toBe(0.9);
  }, 90_000);

  it("折后价落库，支付按折后价走", async () => {
    await buyMembership(MEMBER);
    const order = await createPhysicalOrder(MEMBER, { workId: await unlockedWork(MEMBER), sku: "art-print-a4", address: ADDRESS });
    const rows = await (await getDatabase()).query("SELECT amount FROM physical_orders WHERE id=$1", [order.id]);
    expect(Number(rows[0].amount)).toBe(35.91);
  }, 90_000);

  it("非会员按原价", async () => {
    const order = await createPhysicalOrder(FREE, { workId: await unlockedWork(FREE), sku: "art-print-a4", address: ADDRESS });
    expect(order.amount).toBe(39.9);
    expect(order.memberDiscount).toBeUndefined();
  }, 90_000);

  /** ¥99.9 精装册同样打折 —— 折扣是权益不是单个 SKU 的属性。 */
  it("精装纪念册同样享折扣", async () => {
    await buyMembership(MEMBER);
    const order = await createPhysicalOrder(MEMBER, { workId: await unlockedWork(MEMBER), sku: "memorial-album", address: ADDRESS });
    expect(order.amount).toBe(89.91);
  }, 90_000);
});
