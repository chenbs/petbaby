import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exchangeWechatCode } from "@/server/auth/wechat";
import { signInWechatUser } from "@/server/auth/wechat-account";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";

const KEY = Buffer.alloc(32, 7).toString("base64");

function wechatResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

async function users() {
  return (await getDatabase()).query<{ id: string; wechat_unionid: string | null; wechat_openid: string | null }>("SELECT id,wechat_unionid,wechat_openid FROM users ORDER BY created_at");
}

describe("WeChat accounts are keyed by unionid", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    vi.stubEnv("WECHAT_APP_ID", "wx-test-app");
    vi.stubEnv("WECHAT_APP_SECRET", "test-secret");
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", KEY);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("refuses to log in without unionid instead of falling back to openid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(wechatResponse({ openid: "openid-without-union", session_key: "session-key-1" }));
    await expect(exchangeWechatCode("code-12345678")).rejects.toMatchObject({ code: "WECHAT_UNIONID_REQUIRED", status: 503 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(wechatResponse({ openid: "openid-with-union", session_key: "session-key-1", unionid: "union-0001" }));
    await expect(exchangeWechatCode("code-12345678")).resolves.toMatchObject({ unionid: "union-0001", openid: "openid-with-union" });
  });

  it("registers once per unionid and only records the latest openid", async () => {
    const first = await signInWechatUser({ unionid: "union-0001", openid: "openid-a", session_key: "session-key-a" });
    const again = await signInWechatUser({ unionid: "union-0001", openid: "openid-b", session_key: "session-key-b" });
    expect(again).toBe(first);
    expect(await users()).toEqual([{ id: first, wechat_unionid: "union-0001", wechat_openid: "openid-b" }]);
    // openid 不再唯一：另一个 unionid 带着相同 openid 也能建号（openid 只是记录）
    const other = await signInWechatUser({ unionid: "union-0002", openid: "openid-b", session_key: "session-key-c" });
    expect(other).not.toBe(first);
  });

  it("adopts a legacy openid-only account instead of creating a duplicate", async () => {
    const legacy = "00000000-0000-4000-8000-0000000000e1";
    await (await getDatabase()).query("INSERT INTO users (id,wechat_openid,created_at) VALUES ($1,'legacy-openid',now())", [legacy]);
    expect(await signInWechatUser({ unionid: "union-legacy", openid: "legacy-openid", session_key: "session-key-l" })).toBe(legacy);
    expect((await users())[0]).toMatchObject({ id: legacy, wechat_unionid: "union-legacy" });
  });

  it("rolls the new account back when the WeChat session cannot be stored", async () => {
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", "");
    await expect(signInWechatUser({ unionid: "union-0003", openid: "openid-c", session_key: "session-key-d" })).rejects.toMatchObject({ status: 503 });
    expect(await users()).toEqual([]);
  });
});
