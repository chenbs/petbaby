import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, inTransaction, resetDatabaseForTest } from "@/server/db/client";
import { payGrowthOrder } from "@/server/growth-service";
import { consumePurchasedCredit, grantPurchasedCredit, purchasedCreditBalance } from "@/server/entitlements";
import { createTopupOrder } from "@/server/wallet/topup";
import { getWallet, spend } from "@/server/wallet/service";
import { readWechatSession, storeWechatSession } from "@/server/auth/wechat-session";
import { selectPaymentChannel, virtualEnvironment } from "./config";
import * as providers from "./provider";
import { VirtualPaymentProvider, virtualSignature } from "./virtual-provider";
import { applyPaymentConfirmation, applyRefundedTotal, completeRefund, ensurePayment, getPayment, paymentStatus, prepareOrderPayment, reconcilePayment, refundOrderPayment } from "./service";
import { decryptVirtualMessage, encryptVirtualReply, handleVirtualNotification, iosRefundInquiry } from "./virtual-notify";
import { verifyWechatTransaction } from "./wechat-provider";
import type { Payment, PaymentProvider } from "./types";

const userId = "00000000-0000-4000-8000-000000000071";
const otherUser = "00000000-0000-4000-8000-000000000072";

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.stubEnv("PAYMENT_PROVIDER", "development");
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,wechat_openid,created_at) VALUES ($1,'payment-test-openid',now()),($2,'other-test-openid',now())", [userId, otherUser]);
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function production() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PAYMENT_PROVIDER", "wechat");
  vi.stubEnv("WECHAT_VIRTUAL_PRODUCTS", JSON.stringify({ "fd-topup-38:3800": "topup38", "fd-topup-6-first:600": "first6" }));
}

/** 夹具：一张 38 元充值单（到账 50 颗冻干）。2026-10-08 起取代原先的会员订单夹具。 */
async function topupPayment() {
  const order = await createTopupOrder(userId, { packageId: "p38" });
  return { order, payment: await ensurePayment(userId, "growth", order.id) };
}

async function balance() { return (await getWallet(userId)).balance; }

function fakeProvider(): PaymentProvider {
  return {
    create: vi.fn(async (payment) => ({ providerOrderId: payment.out_trade_no, clientParams: { mode: "virtual" } })),
    query: vi.fn(async () => ({ paid: true, transactionId: "trusted-transaction", channel: "wechat", refundedFen: 0 })),
    refund: vi.fn(async () => undefined),
    queryRefund: vi.fn(async () => "processing" as const),
    acknowledge: vi.fn(async () => undefined),
  };
}

describe("payment boundary and atomic fulfillment", () => {
  it("rejects the production direct-pay bypass without crediting dongan", async () => {
    production();
    const { order, payment } = await topupPayment();
    await expect(payGrowthOrder(userId, order.id)).rejects.toMatchObject({ code: "PAYMENT_ADAPTER_REQUIRED" });
    expect((await getPayment(payment.id)).status).toBe("pending");
    expect(await balance()).toBe(0);
  });

  it("routes virtual and physical goods separately even when the legacy setting says wechat", () => {
    production();
    expect(selectPaymentChannel("growth", "fd-topup-38")).toBe("virtual");
    expect(selectPaymentChannel("growth", "fd-topup-6-first")).toBe("virtual");
    expect(selectPaymentChannel("growth", "annual-report-hd")).toBe("virtual");
    expect(selectPaymentChannel("work", "pl-19-single")).toBe("virtual");
    expect(selectPaymentChannel("physical", "art-print-a4")).toBe("wechat");
    expect(() => selectPaymentChannel("growth", "unknown-sku")).toThrow();
    vi.stubEnv("WECHAT_VIRTUAL_ENV", "1");
    expect(() => virtualEnvironment()).toThrow();
  });

  it("blocks Web payment and cross-user access before preparing payment", async () => {
    const { order } = await topupPayment();
    production();
    await expect(prepareOrderPayment(userId, "growth", order.id, "web")).rejects.toMatchObject({ code: "MINIPROGRAM_PAYMENT_REQUIRED" });
    await expect(paymentStatus(otherUser, "growth", order.id)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("does not grant rights merely because payment parameters were prepared", async () => {
    production();
    const { payment, order } = await topupPayment();
    vi.spyOn(providers, "paymentProviderFor").mockReturnValue(fakeProvider());
    expect((await prepareOrderPayment(userId, "growth", order.id, "miniprogram")).clientParams.mode).toBe("virtual");
    expect((await getPayment(payment.id)).status).toBe("pending");
    expect(await balance()).toBe(0);
  });

  it("fulfills concurrent and repeated notifications exactly once", async () => {
    const { payment, order } = await topupPayment();
    const confirmation = { paid: true, transactionId: "wx-unique", channel: "wechat" };
    await Promise.all(Array.from({ length: 5 }, () => applyPaymentConfirmation(payment.id, confirmation)));
    const database = await getDatabase();
    expect(await database.query("SELECT id FROM wallet_lots WHERE growth_order_id=$1", [order.id])).toHaveLength(1);
    expect(await balance()).toBe(50);
    expect((await getPayment(payment.id)).status).toBe("paid");
  });

  it("rolls the paid status back if entitlement delivery cannot complete", async () => {
    const { payment, order } = await topupPayment();
    // 篡改成未知档位：到账失败必须整笔回滚，不能留下「已付但没到账」或「到账但订单未付」。
    await (await getDatabase()).query("UPDATE growth_orders SET sku='fd-topup-999' WHERE id=$1", [order.id]);
    await expect(applyPaymentConfirmation(payment.id, { paid: true, transactionId: "wx-failure" })).rejects.toMatchObject({ code: "PAYMENT_SKU_UNSUPPORTED" });
    expect((await getPayment(payment.id)).status).toBe("pending");
    expect(await balance()).toBe(0);
  });

  it("repairs a lost callback through the authoritative provider query", async () => {
    production();
    const { payment } = await topupPayment();
    const provider = fakeProvider();
    vi.spyOn(providers, "paymentProviderFor").mockReturnValue(provider);
    expect((await reconcilePayment(payment)).status).toBe("paid");
    expect(await balance()).toBe(50);
    expect(provider.acknowledge).toHaveBeenCalledTimes(1);
    await reconcilePayment(await getPayment(payment.id));
    expect(provider.acknowledge).toHaveBeenCalledTimes(1);
  });

  it("keeps dongan spendable while a real refund is processing and claws it back on confirmation", async () => {
    production();
    const { payment, order } = await topupPayment();
    const provider = fakeProvider();
    vi.spyOn(providers, "paymentProviderFor").mockReturnValue(provider);
    await reconcilePayment(payment);
    const refund = await refundOrderPayment(userId, "growth", order.id);
    expect(refund.status).toBe("processing");
    await completeRefund(refund.id);
    expect((await getPayment(payment.id)).status).toBe("paid");
    expect(await balance()).toBe(50);
    vi.mocked(provider.queryRefund).mockResolvedValue("succeeded");
    vi.mocked(provider.query).mockResolvedValue({ paid: true, transactionId: "trusted-transaction", refundedFen: 3800 });
    await Promise.all([completeRefund(refund.id), completeRefund(refund.id)]);
    expect((await getPayment(payment.id)).refunded_fen).toBe(3800);
    expect(await balance()).toBe(0);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "trusted-transaction" });
    expect((await getPayment(payment.id)).status).toBe("refunded");
  });

  it("reuses a refund number after uncertain channel failures", async () => {
    production();
    const { payment, order } = await topupPayment();
    const provider = fakeProvider();
    vi.spyOn(providers, "paymentProviderFor").mockReturnValue(provider);
    await reconcilePayment(payment);
    vi.mocked(provider.refund).mockRejectedValueOnce(new Error("timeout"));
    await expect(refundOrderPayment(userId, "growth", order.id)).rejects.toThrow("timeout");
    await refundOrderPayment(userId, "growth", order.id);
    const calls = vi.mocked(provider.refund).mock.calls;
    expect(calls[0][1].out_refund_no).toBe(calls[1][1].out_refund_no);
  });

  it("does not allow direct iOS refunds and audits an approval without network calls", async () => {
    production();
    const { payment, order } = await topupPayment();
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "apple-order", channel: "ios" });
    await expect(refundOrderPayment(userId, "growth", order.id)).rejects.toMatchObject({ code: "IOS_REFUND_VIA_APPLE" });
    const start = Date.now();
    const reply = await iosRefundInquiry({ pay_order_id: payment.out_trade_no });
    expect(Date.now() - start).toBeLessThan(3000);
    expect(reply.result_code).toBe(0);
    expect(JSON.parse(reply.evidence)).toMatchObject({ orderFound: true, policy: "allow_refund" });
    await iosRefundInquiry({ pay_order_id: payment.out_trade_no });
    expect(await (await getDatabase()).query("SELECT id FROM payment_refund_inquiries")).toHaveLength(1);
    // 充完就花掉一部分再去 Apple 申请退款：问询必须按「这笔冻干是否已被花掉」判拒绝。
    const consumed = await topupPayment();
    await applyPaymentConfirmation(consumed.payment.id, { paid: true, transactionId: "apple-consumed", channel: "ios" });
    await spend(userId, { units: 60, bizKey: "test:spend-ios", title: "测试消耗" });
    const denied = await iosRefundInquiry({ pay_order_id: consumed.payment.out_trade_no });
    expect(denied.result_code).toBe(1);
    expect(JSON.parse(denied.evidence)).toMatchObject({ policy: "deny_refund_consumed" });
    expect(JSON.parse(denied.evidence).consumedEntitlements).toBeGreaterThan(0);
  });

  it("revokes a legacy purchased export credit after a confirmed refund", async () => {
    // 冻干上线前的历史单买订单：退款仍要回收凭据。新购已不会再创建这种订单，这里直接构造。
    const database = await getDatabase();
    const orderId = crypto.randomUUID();
    await database.query("INSERT INTO growth_orders (id,user_id,kind,resource_id,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'health_archive',NULL,'health-archive-pdf',29.9,'pending','{}',now(),now())", [orderId, userId]);
    await payGrowthOrder(userId, orderId);
    expect(await purchasedCreditBalance(userId, "health_archive")).toBe(1);
    const payment = await ensurePayment(userId, "growth", orderId);
    await applyRefundedTotal(payment.id, 2990);
    expect(await purchasedCreditBalance(userId, "health_archive")).toBe(0);
    expect(await consumePurchasedCredit(userId, "health_archive", "test")).toBe(false);
    await expect(applyRefundedTotal(payment.id, 2991)).rejects.toMatchObject({ code: "REFUND_AMOUNT_INVALID" });
    await grantPurchasedCredit(userId, "health_archive", orderId, "测试凭据");
    expect(await purchasedCreditBalance(userId, "health_archive")).toBe(1);
  });

  it("freezes the wallet when a refunded top-up has already been spent elsewhere", async () => {
    const { payment } = await topupPayment();
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "wx-spent" });
    await spend(userId, { units: 30, bizKey: "test:spend-before-refund", title: "测试消耗" });
    await applyRefundedTotal(payment.id, 3800);
    const wallet = await getWallet(userId);
    expect(wallet.balance).toBe(0);
    expect(wallet.frozen).toBe(true);
    await expect(spend(userId, { units: 1, bizKey: "test:after-freeze", title: "x" })).rejects.toMatchObject({ code: "WALLET_FROZEN" });
  });

  it("rolls back nested service queries on the same transaction connection", async () => {
    await expect(inTransaction(async () => {
      await (await getDatabase()).query("UPDATE users SET wechat_openid='should-rollback' WHERE id=$1", [userId]);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await (await getDatabase()).query("SELECT wechat_openid FROM users WHERE id=$1", [userId]))[0].wechat_openid).toBe("payment-test-openid");
  });
});

describe("provider protocol and verification", () => {
  it("matches both official HMAC golden vectors", () => {
    const body = '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}';
    expect(virtualSignature("12345", `/xpay/query_user_balance&${body}`)).toBe("c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5");
    expect(virtualSignature("9hAb/NEYUlkaMBEsmFgzig==", body)).toBe("089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7");
  });

  it("encrypts session keys at rest and signs exactly the client JSON", async () => {
    production();
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("WECHAT_VIRTUAL_OFFER_ID", "offer-test");
    vi.stubEnv("WECHAT_VIRTUAL_APP_KEY", "private-app-key");
    await storeWechatSession(userId, "private-session-key");
    const stored = await (await getDatabase()).query("SELECT ciphertext FROM wechat_sessions WHERE user_id=$1", [userId]);
    expect(String(stored[0].ciphertext)).not.toContain("private-session-key");
    const { payment } = await topupPayment();
    const prepared = await new VirtualPaymentProvider().create(payment);
    expect(JSON.parse(prepared.clientParams.signData)).toMatchObject({ goodsPrice: 3800, productId: "topup38", outTradeNo: payment.out_trade_no, env: 0 });
    expect(prepared.clientParams.signature).toBe(virtualSignature("private-session-key", prepared.clientParams.signData));
    expect(prepared.clientParams.paySig).toBe(virtualSignature("private-app-key", `requestVirtualPayment&${prepared.clientParams.signData}`));
    expect(prepared.clientParams.paymentMode).toBe("short_series_goods");
    await (await getDatabase()).query("UPDATE wechat_sessions SET updated_at=now()-interval '2 hours' WHERE user_id=$1", [userId]);
    await expect(readWechatSession(userId)).rejects.toMatchObject({ code: "WECHAT_SESSION_EXPIRED" });
  });

  it("rejects merchant, appid, amount, payer and channel substitutions", async () => {
    vi.stubEnv("WECHAT_APP_ID", "wx-app-test");
    vi.stubEnv("WECHAT_MCH_ID", "1117969043");
    const { payment } = await topupPayment();
    const physical = { ...payment, provider: "wechat" } as Payment;
    const transaction = { appid: "wx-app-test", mchid: "1117969043", out_trade_no: physical.out_trade_no, transaction_id: "tx-test", trade_state: "SUCCESS", amount: { total: 3800, currency: "CNY" }, payer: { openid: physical.openid } };
    expect(verifyWechatTransaction(physical, transaction).paid).toBe(true);
    for (const patch of [{ appid: "attacker" }, { mchid: "attacker" }, { amount: { total: 1, currency: "CNY" } }, { payer: { openid: "attacker" } }]) {
      expect(() => verifyWechatTransaction(physical, { ...transaction, ...patch })).toThrow();
    }
    expect(() => verifyWechatTransaction(payment, transaction)).toThrow();
  });

  it("matches the official AES sample and rejects forged notification signatures", async () => {
    vi.stubEnv("WECHAT_MESSAGE_AES_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    vi.stubEnv("WECHAT_APP_ID", "wxba5fad812f8e6fb9");
    vi.stubEnv("WECHAT_MESSAGE_TOKEN", "AAAAA");
    const golden = "ELGduP2YcVatjqIS+eZbp80MNLoAUWvzzyJxgGzxZO/5sAvd070Bs6qrLARC9nVHm48Y4hyRbtzve1L32tmxSQ==";
    expect(decryptVirtualMessage(golden)).toEqual({ demo_resp: "good luck" });
    const encrypted = encryptVirtualReply({ Event: "debug_demo" }, "nonce");
    const url = `https://app.babykitty.cn/api/payments/virtual/notify?timestamp=${encrypted.TimeStamp}&nonce=nonce&msg_signature=${encrypted.MsgSignature}`;
    const response = await handleVirtualNotification(new Request(url, { method: "POST", body: JSON.stringify(encrypted) }));
    expect(await response.text()).toBe("success");
    await expect(handleVirtualNotification(new Request(url.replace(encrypted.MsgSignature, "0".repeat(40)), { method: "POST", body: JSON.stringify(encrypted) }))).rejects.toMatchObject({ code: "VIRTUAL_SIGNATURE_INVALID" });
    vi.stubEnv("WECHAT_APP_ID", "different-app");
    expect(() => decryptVirtualMessage(golden)).toThrow();
  });
});
