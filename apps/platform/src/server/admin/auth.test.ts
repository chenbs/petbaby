import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieWrites: string[] = [];
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: (name: string) => { cookieWrites.push(name); } }) }));

import { POST } from "@/app/api/admin/login/route";
import { passwordAuthEnabled } from "@/server/auth/password";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { upsertAdminAccount } from "./account";
import { loginAdmin } from "./auth";

/*
 * 后台账号密码登录与消费端分开：生产里消费端密码登录恒关，后台仍可用；
 * 只放行白名单账号，各种失败返回同一个错误。
 */

function asProduction() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_ENV", "production");
  vi.stubEnv("PASSWORD_AUTH_ENABLED", "true");
}

const loginRequest = (body: unknown) => new Request("http://localhost/api/admin/login", { method: "POST", headers: { "content-type": "application/json", "x-petbaby-client": "miniprogram", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` }, body: JSON.stringify(body) });

describe("运营后台登录", () => {
  beforeEach(async () => { await resetDatabaseForTest(); });
  afterEach(() => vi.unstubAllEnvs());

  it("生产里消费端密码登录关闭，后台管理员仍能登录", async () => {
    const { userId } = await upsertAdminAccount({ accountName: "ops.lead", password: "petbaby-ops-2026" });
    asProduction();
    vi.stubEnv("ADMIN_USER_IDS", userId);
    expect(passwordAuthEnabled()).toBe(false);
    await expect(loginAdmin({ accountName: "OPS.LEAD", password: "petbaby-ops-2026" })).resolves.toMatchObject({ userId });
  });

  it("不在白名单、密码错、账号不存在、已停用都返回同一个错误", async () => {
    const admin = await upsertAdminAccount({ accountName: "ops.lead", password: "petbaby-ops-2026" });
    const other = await upsertAdminAccount({ accountName: "ops.other", password: "petbaby-ops-2026" });
    asProduction();
    vi.stubEnv("ADMIN_USER_IDS", admin.userId);
    const invalid = { code: "INVALID_CREDENTIALS", status: 401 };
    await expect(loginAdmin({ accountName: "ops.other", password: "petbaby-ops-2026" })).rejects.toMatchObject(invalid);
    await expect(loginAdmin({ accountName: "ops.lead", password: "petbaby-ops-2027" })).rejects.toMatchObject(invalid);
    await expect(loginAdmin({ accountName: "nobody", password: "petbaby-ops-2026" })).rejects.toMatchObject(invalid);
    await (await getDatabase()).query("UPDATE users SET admin_suspended_at=now() WHERE id=$1", [admin.userId]);
    await expect(loginAdmin({ accountName: "ops.lead", password: "petbaby-ops-2026" })).rejects.toMatchObject(invalid);
    expect(other.created).toBe(true);
  });

  it("重设密码复用原账号，旧密码失效；弱密码与非法账号名拒绝", async () => {
    const first = await upsertAdminAccount({ accountName: "ops.lead", password: "petbaby-ops-2026", displayName: "运营负责人" });
    const second = await upsertAdminAccount({ accountName: "Ops.Lead", password: "petbaby-ops-2027" });
    expect(second).toMatchObject({ userId: first.userId, created: false });
    vi.stubEnv("ADMIN_USER_IDS", first.userId);
    vi.stubEnv("NODE_ENV", "production");
    await expect(loginAdmin({ accountName: "ops.lead", password: "petbaby-ops-2026" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(loginAdmin({ accountName: "ops.lead", password: "petbaby-ops-2027" })).resolves.toMatchObject({ userId: first.userId });
    await expect(upsertAdminAccount({ accountName: "ops.weak", password: "short1" })).rejects.toMatchObject({ code: "PASSWORD_WEAK" });
    await expect(upsertAdminAccount({ accountName: "1ops", password: "petbaby-ops-2026" })).rejects.toMatchObject({ code: "ACCOUNT_NAME_INVALID" });
  });

  it("登录接口写 Cookie 与审计，不在响应里返回 token", async () => {
    const { userId } = await upsertAdminAccount({ accountName: "ops.lead", password: "petbaby-ops-2026" });
    vi.stubEnv("ADMIN_USER_IDS", userId);
    vi.stubEnv("SESSION_SECRET", "a".repeat(40));
    const response = await POST(loginRequest({ accountName: "ops.lead", password: "petbaby-ops-2026" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ok: true } });
    expect(cookieWrites).toContain("petbaby_session");
    const audit = await (await getDatabase()).query("SELECT action FROM audit_logs WHERE actor_id=$1", [userId]);
    expect(audit).toEqual([{ action: "admin_login" }]);
    const failed = await POST(loginRequest({ accountName: "ops.lead", password: "wrong-password-1" }));
    expect(failed.status).toBe(401);
  });
});
