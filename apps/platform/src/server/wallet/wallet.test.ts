import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { applyPaymentConfirmation, applyRefundedTotal, ensurePayment } from "@/server/payments/service";
import { createTopupOrder, listTopupPackages } from "@/server/wallet/topup";
import {
  credit,
  expireGiftLots,
  getNewcomerGiftOffer,
  getWallet,
  grantByAdmin,
  grantNewcomerGift,
  listWalletLedger,
  outstandingSpend,
  refundSpend,
  spend,
} from "@/server/wallet/service";
import { AI_RUN_COST, ART_PHOTO_BUNDLE_COST, MAX_TASK_ATTEMPTS, describeCost, isPaidLayoutPlugin, resolveDeliverableCost, tierCosts } from "@/domain/dongan-pricing";

const USER = "00000000-0000-4000-8000-0000000000d1";
const OTHER = "00000000-0000-4000-8000-0000000000d2";
const DAY = 86_400_000;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("PAYMENT_PROVIDER", "development");
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,wechat_unionid,wechat_openid,created_at) VALUES ($1,'wallet-unionid','wallet-openid',now()),($2,NULL,NULL,now())", [USER, OTHER]);
});

async function gift(units: number, days: number, key: string) {
  return credit(USER, { pocket: "gift", source: "admin_grant", units, bizKey: key, title: "测试赠送", expiresAt: new Date(Date.now() + days * DAY) });
}
async function purchase(units: number, key: string) {
  return credit(USER, { pocket: "purchased", source: "topup", units, bizKey: key, title: "测试充值" });
}

describe("冻干钱包：扣减、退还与过期", () => {
  it("先扣最早到期的赠送所得，再按入账先后扣购买所得", async () => {
    await purchase(10, "p1");
    await gift(3, 30, "g-late");
    await gift(2, 5, "g-early");
    const charged = await spend(USER, { units: 6, bizKey: "s1", title: "测试" });
    expect(charged).toMatchObject({ delta: -6, balanceAfter: 9, replayed: false });
    const lots = await (await getDatabase()).query<{ pocket: string; remaining: number; units: number }>("SELECT pocket,remaining,units FROM wallet_lots WHERE user_id=$1 ORDER BY pocket,expires_at", [USER]);
    // 赠送 2（5 天）与 3（30 天）先被用光，购买所得只扣 1。
    expect(lots.map((lot) => [lot.pocket, lot.remaining])).toEqual([["gift", 0], ["gift", 0], ["purchased", 9]]);
  });

  it("同一个业务键只扣一次；余额不足给出差额且不改动账本", async () => {
    await purchase(5, "p1");
    await spend(USER, { units: 3, bizKey: "same", title: "x" });
    expect((await spend(USER, { units: 3, bizKey: "same", title: "x" })).replayed).toBe(true);
    expect((await getWallet(USER)).balance).toBe(2);
    await expect(spend(USER, { units: 3, bizKey: "too-much", title: "x" })).rejects.toMatchObject({ code: "WALLET_INSUFFICIENT", status: 402, details: { required: 3, balance: 2, shortfall: 1 } });
    expect((await listWalletLedger(USER)).items).toHaveLength(2);
    await expect(spend(USER, { units: 0, bizKey: "zero", title: "x" })).rejects.toMatchObject({ code: "WALLET_UNITS_INVALID" });
  });

  it("并发扣减不会透支", async () => {
    await purchase(5, "p1");
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => spend(USER, { units: 2, bizKey: `c${index}`, title: "x" })));
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(2);
    expect((await getWallet(USER)).balance).toBe(1);
  });

  it("赠送过期与扣费并发时锁定顺序一致，流水只清零一次", async () => {
    await purchase(5, "concurrent-purchase");
    await gift(3, 1, "concurrent-gift");
    await (await getDatabase()).query("UPDATE wallet_lots SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND pocket='gift'", [USER]);
    const results = await Promise.allSettled([
      expireGiftLots(),
      spend(USER, { units: 2, bizKey: "concurrent-expire-spend", title: "制作" }),
      getWallet(USER),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect((await getWallet(USER)).balance).toBe(3);
    const rows = await (await getDatabase()).query("SELECT delta FROM wallet_ledger WHERE user_id=$1 AND reason='expire'", [USER]);
    expect(rows).toEqual([{ delta: -3 }]);
  });

  it("失败按原批次全额退还，部分退还按片段计数，不会退过头", async () => {
    await purchase(4, "p1");
    await gift(2, 10, "g1");
    await spend(USER, { units: 5, bizKey: "job", title: "套餐" });
    expect(await refundSpend("job", { units: 1, part: "item:a" })).toBe(1);
    expect(await refundSpend("job", { units: 1, part: "item:a" })).toBe(0);
    expect(await outstandingSpend("job")).toBe(4);
    expect(await refundSpend("job")).toBe(4);
    expect(await refundSpend("job")).toBe(0);
    expect(await refundSpend("not-a-spend")).toBe(0);
    expect((await getWallet(USER)).balance).toBe(6);
  });

  it("退还到已过期的赠送批次时重新给 7 天有效期", async () => {
    await gift(2, 1, "g1");
    await spend(USER, { units: 2, bizKey: "job", title: "x" });
    await (await getDatabase()).query("UPDATE wallet_lots SET expires_at=now()-interval '1 hour' WHERE user_id=$1", [USER]);
    expect(await refundSpend("job")).toBe(2);
    const lot = (await (await getDatabase()).query("SELECT status,remaining,expires_at FROM wallet_lots WHERE user_id=$1", [USER]))[0];
    expect(lot.status).toBe("active");
    expect(Number(lot.remaining)).toBe(2);
    expect(new Date(String(lot.expires_at)).getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  it("赠送所得到期清零并写流水；读余额时即时生效", async () => {
    await purchase(3, "p1");
    await gift(4, 1, "g1");
    await (await getDatabase()).query("UPDATE wallet_lots SET expires_at=now()-interval '1 minute' WHERE pocket='gift'");
    expect((await getWallet(USER)).balance).toBe(3);
    expect(await expireGiftLots()).toBe(0);
    const ledger = (await listWalletLedger(USER)).items;
    expect(ledger[0]).toMatchObject({ reason: "expire", delta: -4, balanceAfter: 3 });
    await expect(credit(USER, { pocket: "gift", source: "admin_grant", units: 1, bizKey: "no-expiry", title: "x" })).rejects.toMatchObject({ code: "WALLET_GIFT_EXPIRY_REQUIRED" });
  });

  it("Worker 兜底过期任务处理所有用户", async () => {
    await gift(2, 1, "g1");
    await (await getDatabase()).query("UPDATE wallet_lots SET expires_at=now()-interval '1 minute'");
    expect(await expireGiftLots()).toBe(1);
    expect((await getWallet(USER)).giftBalance).toBe(0);
  });

  it("新人礼每个微信身份只发一次，注销重注册也不重复", async () => {
    expect((await grantNewcomerGift(USER))?.delta).toBe(3);
    expect(await grantNewcomerGift(USER)).toBeUndefined();
    const database = await getDatabase();
    const reborn = "00000000-0000-4000-8000-0000000000d3";
    await database.query("UPDATE users SET wechat_unionid=NULL,wechat_openid=NULL,deleted_at=now() WHERE id=$1", [USER]);
    await database.query("INSERT INTO users (id,wechat_unionid,wechat_openid,created_at) VALUES ($1,'wallet-unionid','wallet-openid-2',now())", [reborn]);
    expect(await grantNewcomerGift(reborn)).toBeUndefined();
    expect((await getWallet(reborn)).balance).toBe(0);
    // 没有 unionid 的账号按用户发一次。
    expect((await grantNewcomerGift(OTHER))?.delta).toBe(3);
  });

  it("见面礼展示口径与发放一致：未领给颗数与有效期，领过或同一微信身份领过都不再展示", async () => {
    expect(await getNewcomerGiftOffer(USER)).toEqual({ available: true, units: 3, days: 7 });
    await grantNewcomerGift(USER);
    expect((await getNewcomerGiftOffer(USER)).available).toBe(false);
    const database = await getDatabase();
    const reborn = "00000000-0000-4000-8000-0000000000d4";
    await database.query("UPDATE users SET wechat_unionid=NULL,wechat_openid=NULL,deleted_at=now() WHERE id=$1", [USER]);
    await database.query("INSERT INTO users (id,wechat_unionid,wechat_openid,created_at) VALUES ($1,'wallet-unionid','wallet-openid-2',now())", [reborn]);
    expect((await getNewcomerGiftOffer(reborn)).available).toBe(false);
    expect((await getNewcomerGiftOffer(OTHER)).available).toBe(true);
  });

  it("收支明细游标分页", async () => {
    await purchase(10, "p1");
    for (let index = 0; index < 3; index += 1) await spend(USER, { units: 1, bizKey: `s${index}`, title: `第 ${index} 次` });
    const first = await listWalletLedger(USER, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await listWalletLedger(USER, { limit: 2, before: first.nextCursor });
    // 4 条流水分两页，不重不漏（同一毫秒写入的几条也不能被游标跳过）。
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeUndefined();
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(4);
    await expect(listWalletLedger(USER, { before: "not-a-cursor" })).rejects.toMatchObject({ code: "WALLET_CURSOR_INVALID" });
  });

  it("后台补偿只能发有有效期的赠送所得", async () => {
    const granted = await grantByAdmin(OTHER, USER, { units: 5, days: 30, reason: "制作超时" });
    expect(granted).toMatchObject({ delta: 5, reason: "admin_grant" });
    expect((await getWallet(USER)).giftBalance).toBe(5);
    await expect(grantByAdmin(OTHER, USER, { units: 5, days: 0, reason: "x" })).rejects.toMatchObject({ code: "WALLET_GIFT_DAYS_INVALID" });
    await expect(grantByAdmin(OTHER, crypto.randomUUID(), { units: 5, days: 3, reason: "x" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});

describe("冻干充值", () => {
  it("档位与加送比例按 6 元 6 颗的基础档折算", async () => {
    const packages = await listTopupPackages(USER);
    expect(packages.first).toMatchObject({ amount: 6, units: 12, gift: 6, giftPercent: 100 });
    expect(packages.packages.map((item) => [item.amount, item.units, item.giftPercent])).toEqual([[6, 6, 0], [18, 22, 22], [38, 50, 32], [68, 95, 40], [128, 188, 47]]);
    expect(packages.packages[2]).toMatchObject({ discount: 7.6, photos: 25, badge: "最多人选" });
  });

  it("首充到账 12 颗且只能用一次；并发两单首充，第二单按普通 6 元档到账", async () => {
    const first = await createTopupOrder(USER, { packageId: "first" });
    const second = await createTopupOrder(USER, { packageId: "first" });
    const payments = await Promise.all([first, second].map((order) => ensurePayment(USER, "growth", order.id)));
    await Promise.all(payments.map((payment, index) => applyPaymentConfirmation(payment.id, { paid: true, transactionId: `dev-first-${index}` })));
    expect((await getWallet(USER)).balance).toBe(18);
    expect((await getWallet(USER)).firstTopupAvailable).toBe(false);
    await expect(createTopupOrder(USER, { packageId: "first" })).rejects.toMatchObject({ code: "FIRST_TOPUP_USED" });
    expect((await listTopupPackages(USER)).first).toBeUndefined();
    const titles = (await listWalletLedger(USER)).items.map((item) => item.title);
    expect(titles.some((title) => title.includes("按普通档到账"))).toBe(true);
  });

  it("单日累计充值不超过 300 元", async () => {
    await createTopupOrder(USER, { packageId: "p128" });
    await createTopupOrder(USER, { packageId: "p128" });
    await expect(createTopupOrder(USER, { packageId: "p68" })).rejects.toMatchObject({ code: "TOPUP_DAILY_LIMIT", status: 429 });
  });

  it("全额退款扣回这笔冻干；未消耗时余额归零但不冻结", async () => {
    const order = await createTopupOrder(USER, { packageId: "p18" });
    const payment = await ensurePayment(USER, "growth", order.id);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "dev-18" });
    expect((await getWallet(USER)).balance).toBe(22);
    await applyRefundedTotal(payment.id, 1800);
    expect(await getWallet(USER)).toMatchObject({ balance: 0, frozen: false });
    expect((await listWalletLedger(USER)).items[0]).toMatchObject({ reason: "topup_refund", delta: -22 });
  });

  it("退款时这批已花掉，就从之后的购买所得补扣，补得上就不冻结", async () => {
    // 充值单先到账（较早），再有一笔购买所得；扣减按入账先后，先把充值这批花光。
    const order = await createTopupOrder(USER, { packageId: "p18" });
    const payment = await ensurePayment(USER, "growth", order.id);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "dev-18b" });
    await purchase(30, "later-purchase");
    await spend(USER, { units: 25, bizKey: "big", title: "x" });
    await applyRefundedTotal(payment.id, 1800);
    // 52 - 25 = 27，再扣回 22 颗 = 5。
    expect(await getWallet(USER)).toMatchObject({ balance: 5, frozen: false });
  });

  it("补扣也不够时冻结账户，余额不会变成负数", async () => {
    await purchase(30, "early-purchase");
    const order = await createTopupOrder(USER, { packageId: "p18" });
    const payment = await ensurePayment(USER, "growth", order.id);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "dev-18c" });
    await spend(USER, { units: 40, bizKey: "big", title: "x" });
    await applyRefundedTotal(payment.id, 1800);
    expect(await getWallet(USER)).toMatchObject({ balance: 0, frozen: true });
  });
});

describe("冻干价目", () => {
  it("颗数表与 36 号文一致", () => {
    expect(AI_RUN_COST).toEqual({ pet: 2, "pet-human": 4, "owner-pet": 6 });
    expect(ART_PHOTO_BUNDLE_COST).toEqual({ ten: 12, twenty: 20 });
    expect(MAX_TASK_ATTEMPTS).toBe(3);
    expect(resolveDeliverableCost({ pluginId: "pet-movie-poster" })).toEqual({ cost: 5 });
    expect(resolveDeliverableCost({ pluginId: "pet-time-album", accumulation: { photoCount: 21, spanDays: 10 } })).toEqual({ cost: 28, tier: "advanced" });
    expect(resolveDeliverableCost({ pluginId: "pl-19", accumulation: { photoCount: 3, spanDays: 400 } })).toEqual({ cost: 30, tier: "annual" });
    expect(resolveDeliverableCost({ pluginId: "pl-19", memorial: true })).toEqual({ cost: 26 });
    expect(resolveDeliverableCost({ pluginId: "pet-time-album", memorial: true })).toEqual({ cost: 0 });
    expect(resolveDeliverableCost({ pluginId: "pet-id-card" })).toEqual({ cost: 0 });
    expect(resolveDeliverableCost({ pluginId: "pl-19" })).toEqual({ cost: 15, tier: "basic" });
    expect(tierCosts("pet-time-album")).toEqual({ basic: 18, advanced: 28, annual: 38 });
    expect(tierCosts("pet-id-card")).toBeUndefined();
    expect(isPaidLayoutPlugin("pet-movie-poster")).toBe(true);
    expect(isPaidLayoutPlugin("pl-23")).toBe(false);
    expect(describeCost(3)).toBe("3 颗");
  });
});
