import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { getWallet, spend } from "@/server/wallet/service";
import { createTopupOrder } from "@/server/wallet/topup";
import { applyPaymentConfirmation, ensurePayment } from "@/server/payments/service";
import * as adminAudit from "@/server/admin/audit";
import { GET, POST } from "./route";

const ACTOR = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000c2";
vi.mock("@/server/auth/session", () => ({ requireUserId: async () => "00000000-0000-4000-8000-0000000000c1" }));

describe("钱包后台查询、补偿与权限", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await resetDatabaseForTest();
    await (await getDatabase()).query("INSERT INTO users(id,created_at) VALUES($1,now()),($2,now())", [ACTOR, USER]);
  });

  it("补偿必须有期限、数量与原因，入账流水和审计一起可查询", async () => {
    const response = await POST(new Request("http://localhost/api/admin/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "grant_gift", userId: USER, units: 9, days: 7, reason: "出图问题补偿" }) }));
    expect(response.status).toBe(201);
    expect((await getWallet(USER)).balance).toBe(9);
    const reportResponse = await GET(new Request(`http://localhost/api/admin/wallet?userId=${USER}`));
    expect(reportResponse.status).toBe(200);
    const report = await reportResponse.json();
    expect(report.data.user.wallet.balance).toBe(9);
    expect(report.data.user.lots[0]).toMatchObject({ pocket: "gift", remaining: 9 });
    expect(report.data.user.lots[0].expires_at).toBeTruthy();
    expect(report.data.daily[0]).toMatchObject({ gifted_units: 9, spent_units: 0 });
    expect(report.data.topupRevenue.amount).toBe(0);
    const audit = await (await getDatabase()).query("SELECT action,metadata->>'reason' reason FROM audit_logs WHERE target_id=$1", [USER]);
    expect(audit).toEqual([expect.objectContaining({ action: "wallet_grant_gift", reason: "出图问题补偿" })]);
    for (const invalid of [{ units: 0 }, { days: 0 }, { reason: "" }]) {
      const rejected = await POST(new Request("http://localhost/api/admin/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "grant_gift", userId: USER, units: 1, days: 1, reason: "补偿", ...invalid }) }));
      expect(rejected.status).toBe(422);
    }
    expect((await getWallet(USER)).balance).toBe(9);
  });

  it("生产环境非管理员不能读取或补偿钱包", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", USER);
    expect((await GET(new Request("http://localhost/api/admin/wallet"))).status).toBe(404);
    const response = await POST(new Request("http://localhost/api/admin/wallet", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" }, body: JSON.stringify({ action: "grant_gift", userId: USER, units: 9, days: 7, reason: "权限检查" }) }));
    expect(response.status).toBe(404);
    expect((await getWallet(USER)).balance).toBe(0);
  });

  it("充值收入只记现金，冻干消耗减少负债且不重复计收入", async () => {
    const order = await createTopupOrder(USER, { packageId: "p18" });
    const payment = await ensurePayment(USER, "growth", order.id);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: "wallet-admin-revenue" });
    await spend(USER, { units: 4, bizKey: "wallet-admin-use", title: "人宠写真", refType: "ai_run" });
    const response = await GET(new Request("http://localhost/api/admin/wallet"));
    expect(response.status).toBe(200);
    const report = (await response.json()).data;
    expect(report.topupRevenue).toEqual({ amount: 18, orders: 1 });
    expect(report.daily[0]).toMatchObject({ topup_units: 22, spent_units: 4 });
    expect(report.liability).toMatchObject({ purchasedUnits: 18, purchasedAmount: 14.73 });
    expect(report.spendByKind).toEqual([expect.objectContaining({ ref_type: "ai_run", units: 4 })]);
  });

  it("审计写入失败时补偿入账同步回滚", async () => {
    const audit = vi.spyOn(adminAudit, "recordAdminAudit").mockRejectedValueOnce(new Error("AUDIT_TEST_FAILURE"));
    try {
      const response = await POST(new Request("http://localhost/api/admin/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "grant_gift", userId: USER, units: 9, days: 7, reason: "事务回滚测试" }) }));
      expect(response.status).toBe(500);
      expect((await getWallet(USER)).balance).toBe(0);
    } finally { audit.mockRestore(); }
  });
});
