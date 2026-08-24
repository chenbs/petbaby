import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { hasHealthExport, hasTierUnlock } from "@/server/entitlements";

const USER = "00000000-0000-4000-8000-0000000000d1";
const OTHER = "00000000-0000-4000-8000-0000000000d2";

async function grantMembership(userId: string, options: { entitlements: Record<string, unknown>; status?: string; expiresAt?: Date }) {
  const database = await getDatabase();
  await database.query(
    "INSERT INTO memberships (id,user_id,plan,status,quota,expires_at,quota_reset_at,entitlements,order_id,created_at) VALUES ($1,$2,'yearly',$3,0,$4,$4,$5::jsonb,$6,now())",
    [
      crypto.randomUUID(),
      userId,
      options.status || "active",
      options.expiresAt || new Date(Date.now() + 86_400_000),
      JSON.stringify(options.entitlements),
      crypto.randomUUID(),
    ],
  );
}

describe("会员权益判定", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("DELETE FROM memberships");
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [OTHER]);
  });

  it("无会员时全部权益为否", async () => {
    expect(await hasTierUnlock(USER)).toBe(false);
    expect(await hasHealthExport(USER)).toBe(false);
  });

  it("年度会员享有规格上限解锁与健康导出", async () => {
    await grantMembership(USER, { entitlements: { tierUnlock: true, healthExportUnlimited: true } });
    expect(await hasTierUnlock(USER)).toBe(true);
    expect(await hasHealthExport(USER)).toBe(true);
  });

  /** 权益不互相牵连：只给一项时另一项仍为否。 */
  it("权益逐项判定", async () => {
    await grantMembership(USER, { entitlements: { tierUnlock: true } });
    expect(await hasTierUnlock(USER)).toBe(true);
    expect(await hasHealthExport(USER)).toBe(false);
  });

  /*
   * 只认 status='active' 且未过期 —— 与 platform-service 的额度扣减
   * 同一个判定条件，避免「额度那边认、权益这边不认」。
   */
  it("未支付的会员不生效", async () => {
    await grantMembership(USER, { entitlements: { tierUnlock: true }, status: "pending" });
    expect(await hasTierUnlock(USER)).toBe(false);
  });

  it("已过期的会员不生效", async () => {
    await grantMembership(USER, { entitlements: { tierUnlock: true }, expiresAt: new Date(Date.now() - 86_400_000) });
    expect(await hasTierUnlock(USER)).toBe(false);
  });

  it("权益不跨用户泄漏", async () => {
    await grantMembership(USER, { entitlements: { tierUnlock: true, healthExportUnlimited: true } });
    expect(await hasTierUnlock(OTHER)).toBe(false);
    expect(await hasHealthExport(OTHER)).toBe(false);
  });

  /*
   * 旧结构（含 monthlyQuota、无 tierUnlock）的历史会员记录不该拿到新权益，
   * 但也不能让判定报错 —— 月度会员要履约到期。
   */
  it("旧结构权益不报错且不误授权", async () => {
    await grantMembership(USER, { entitlements: { monthlyQuota: 10, hdReports: true } });
    expect(await hasTierUnlock(USER)).toBe(false);
    expect(await hasHealthExport(USER)).toBe(false);
  });
});
