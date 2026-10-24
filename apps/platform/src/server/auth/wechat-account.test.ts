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

describe("WeChat accounts are keyed by openid", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    vi.stubEnv("WECHAT_APP_ID", "wx-test-app");
    vi.stubEnv("WECHAT_APP_SECRET", "test-secret");
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", KEY);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("logs in with openid alone and ignores unionid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(wechatResponse({ openid: "openid-without-union", session_key: "session-key-1" }));
    await expect(exchangeWechatCode("code-12345678")).resolves.toEqual({ openid: "openid-without-union", session_key: "session-key-1" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(wechatResponse({ openid: "openid-with-union", session_key: "session-key-1", unionid: "union-0001" }));
    await expect(exchangeWechatCode("code-12345678")).resolves.toEqual({ openid: "openid-with-union", session_key: "session-key-1" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(wechatResponse({ errcode: 40029, errmsg: "invalid code" }));
    await expect(exchangeWechatCode("code-12345678")).rejects.toMatchObject({ code: "WECHAT_LOGIN_FAILED", status: 401 });
  });

  it("registers once per openid and never writes unionid", async () => {
    const first = await signInWechatUser({ openid: "openid-a", session_key: "session-key-a" });
    const again = await signInWechatUser({ openid: "openid-a", session_key: "session-key-b" });
    expect(again).toBe(first);
    expect(await users()).toEqual([{ id: first, wechat_unionid: null, wechat_openid: "openid-a" }]);
    const other = await signInWechatUser({ openid: "openid-b", session_key: "session-key-c" });
    expect(other).not.toBe(first);
  });

  it("converges concurrent first logins onto one row", async () => {
    const ids = await Promise.all([
      signInWechatUser({ openid: "openid-race", session_key: "session-key-r1" }),
      signInWechatUser({ openid: "openid-race", session_key: "session-key-r2" }),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(await users()).toHaveLength(1);
  });

  it("gives a deleted account's WeChat user a fresh account", async () => {
    const first = await signInWechatUser({ openid: "openid-gone", session_key: "session-key-g" });
    await (await getDatabase()).query("UPDATE users SET deleted_at=now(),wechat_openid=NULL WHERE id=$1", [first]);
    expect(await signInWechatUser({ openid: "openid-gone", session_key: "session-key-h" })).not.toBe(first);
  });

  it("rolls the new account back when the WeChat session cannot be stored", async () => {
    vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", "");
    await expect(signInWechatUser({ openid: "openid-c", session_key: "session-key-d" })).rejects.toMatchObject({ status: 503 });
    expect(await users()).toEqual([]);
  });
});
