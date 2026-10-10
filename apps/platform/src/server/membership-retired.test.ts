import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { selectPaymentChannel } from "@/server/payments/config";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

/*
 * 会员下线（2026-10-08，36 号文第 5 章）的回归防线。
 *
 * 三个最容易「静默复活」的点各钉一条：测试重置会重灌年卡种子、后台还能新建套餐、路由还在。
 */
describe("年度会员已下线", () => {
  beforeEach(async () => { await resetDatabaseForTest(); });

  it("测试重置后所有会员套餐都是 archived，没有在售套餐", async () => {
    const rows = await (await getDatabase()).query<{ status: string }>("SELECT DISTINCT status FROM membership_plan_versions");
    expect(rows.map((row) => row.status)).toEqual(["archived"]);
  });

  it("会员与单买健康档案的路由已移除", () => {
    for (const route of ["membership-plans", "memberships", "health-documents/orders"]) {
      expect(existsSync(path.join(process.cwd(), "src/app/api", route, "route.ts")), route).toBe(false);
    }
  });

  it("后台不再接受新建套餐与调整会员额度", async () => {
    const { POST } = await import("@/app/api/admin/business/route");
    for (const action of [
      { action: "create_plan", code: "yearly", label: "年度会员", amount: 128, period: "year", status: "active", reason: "复活测试" },
      { action: "adjust_entitlement", membershipId: crypto.randomUUID(), units: 1, reason: "复活测试" },
    ]) {
      const response = await POST(new Request("http://localhost/api/admin/business", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(action) }));
      expect(response.status).toBe(422);
    }
  });

  it("冻干充值档走虚拟支付，未知档位拒绝", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("PAYMENT_PROVIDER", "wechat");
    for (const sku of ["fd-topup-6-first", "fd-topup-6", "fd-topup-18", "fd-topup-38", "fd-topup-68", "fd-topup-128"]) expect(selectPaymentChannel("growth", sku)).toBe("virtual");
    expect(() => selectPaymentChannel("growth", "fd-topup-999")).toThrow();
    vi.unstubAllEnvs();
  });
});
