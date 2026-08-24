import { afterEach, describe, expect, it, vi } from "vitest";

import { assertPasswordAuthEnabled, hashPassword, loginWithPassword, normalizeAccountName, passwordAuthEnabled, registerWithPassword, verifyPassword } from "@/server/auth/password";
import { resetDatabaseForTest } from "@/server/db/client";

describe("account/password credentials", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps password login closed in production unless explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PASSWORD_AUTH_ENABLED", "");
    expect(passwordAuthEnabled()).toBe(false);
    expect(() => assertPasswordAuthEnabled()).toThrowError(expect.objectContaining({ code: "PASSWORD_AUTH_DISABLED", status: 403 }));
    vi.stubEnv("PASSWORD_AUTH_ENABLED", "true");
    expect(passwordAuthEnabled()).toBe(true);
    expect(() => assertPasswordAuthEnabled()).not.toThrow();
  });

  it("rejects malformed accounts and weak passwords", async () => {
    expect(normalizeAccountName("  tester.01 ")).toBe("tester.01");
    expect(() => normalizeAccountName("1abc")).toThrowError(expect.objectContaining({ code: "ACCOUNT_NAME_INVALID" }));
    await expect(registerWithPassword({ accountName: "tester", password: "short1" })).rejects.toMatchObject({ code: "PASSWORD_WEAK" });
    await expect(registerWithPassword({ accountName: "tester", password: "allletterspassword" })).rejects.toMatchObject({ code: "PASSWORD_WEAK" });
  });

  it("hashes with scrypt and rejects tampered digests", async () => {
    const stored = await hashPassword("petbaby-test-2026");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("petbaby-test-2026", stored)).toBe(true);
    expect(await verifyPassword("petbaby-test-2027", stored)).toBe(false);
    expect(await verifyPassword("petbaby-test-2026", null)).toBe(false);
    expect(await verifyPassword("petbaby-test-2026", "plain$1$1$1$aa$bb")).toBe(false);
    expect(await verifyPassword("petbaby-test-2026", stored.replace("scrypt$16384", "scrypt$99999999"))).toBe(false);
  });

  it("registers once, logs in case-insensitively and blocks suspended accounts", async () => {
    await resetDatabaseForTest();
    const created = await registerWithPassword({ accountName: "Tester", password: "petbaby-test-2026", displayName: "测试账号" });
    await expect(registerWithPassword({ accountName: "tester", password: "petbaby-test-2026" })).rejects.toMatchObject({ code: "ACCOUNT_TAKEN", status: 409 });
    await expect(loginWithPassword({ accountName: "TESTER", password: "petbaby-test-2026" })).resolves.toMatchObject({ userId: created.userId });
    await expect(loginWithPassword({ accountName: "tester", password: "wrong-password-1" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    await expect(loginWithPassword({ accountName: "ghost", password: "petbaby-test-2026" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const { getDatabase } = await import("@/server/db/client");
    const database = await getDatabase();
    await database.query("UPDATE users SET admin_suspended_at=now() WHERE id=$1", [created.userId]);
    await expect(loginWithPassword({ accountName: "tester", password: "petbaby-test-2026" })).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED", status: 403 });
  });

  it("requires the invite code when the environment sets one", async () => {
    await resetDatabaseForTest();
    vi.stubEnv("PASSWORD_AUTH_INVITE_CODE", "petbaby-invite");
    await expect(registerWithPassword({ accountName: "invited", password: "petbaby-test-2026" })).rejects.toMatchObject({ code: "INVITE_CODE_INVALID", status: 403 });
    await expect(registerWithPassword({ accountName: "invited", password: "petbaby-test-2026", inviteCode: "petbaby-invite" })).resolves.toMatchObject({ accountName: "invited" });
  });
});
