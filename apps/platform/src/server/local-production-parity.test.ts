import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * 2026-10-09：本地开发与生产功能一致，只有自动化测试夹具（NODE_ENV=test 或 PETBABY_TEST_HARNESS=1）
 * 才保留 demo 用户、开放后台与占位实现。这里钉住「NODE_ENV=development 且不是夹具」时的口径。
 */
function localDevelopment() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PETBABY_TEST_HARNESS", "");
}

describe("local development matches production", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("only the test harness counts as a harness, never a production build", async () => {
    const { isTestHarness } = await import("@/server/runtime-mode");
    localDevelopment();
    expect(isTestHarness()).toBe(false);
    vi.stubEnv("PETBABY_TEST_HARNESS", "1");
    expect(isTestHarness()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestHarness()).toBe(false);
  });

  it("keeps the admin console behind ADMIN_USER_IDS locally", async () => {
    const { isAdmin } = await import("@/server/auth/admin");
    localDevelopment();
    vi.stubEnv("ADMIN_USER_IDS", "00000000-0000-4000-8000-0000000000aa");
    expect(isAdmin("00000000-0000-4000-8000-0000000000aa")).toBe(true);
    expect(isAdmin("00000000-0000-4000-8000-0000000000bb")).toBe(false);
  });

  it("requires an explicit flag for password login and an Origin for browser mutations", async () => {
    const { passwordAuthEnabled } = await import("@/server/auth/password");
    const { assertTrustedOrigin } = await import("@/server/auth/request-guard");
    localDevelopment();
    vi.stubEnv("PASSWORD_AUTH_ENABLED", "");
    expect(passwordAuthEnabled()).toBe(false);
    expect(() => assertTrustedOrigin(new Request("http://localhost/api/pets", { method: "POST" }))).toThrowError(expect.objectContaining({ code: "ORIGIN_REQUIRED" }));
    expect(() => assertTrustedOrigin(new Request("http://localhost/api/pets", { method: "POST", headers: { "x-petbaby-client": "miniprogram" } }))).not.toThrow();
  });

  it("fails image generation instead of returning placeholders when no provider is configured", async () => {
    localDevelopment();
    for (const key of ["LINGSUAN_IMAGE_BASE_URL", "LINGSUAN_IMAGE_API_KEY", "AI_IMAGE_ENDPOINT", "AI_IMAGE_API_KEY", "AI_IMAGE_SECONDARY_ENDPOINT", "AI_IMAGE_SECONDARY_API_KEY"]) vi.stubEnv(key, "");
    vi.resetModules();
    const { imageProvider } = await import("@/server/ai/provider");
    expect(imageProvider.name).toBe("unconfigured");
    await expect(imageProvider.generate("本地无凭据", 1)).rejects.toMatchObject({ code: "AI_PROVIDER_CONFIG_PENDING", status: 503 });
  });

  it("fails the health assistant instead of using local rules when no model is configured", async () => {
    localDevelopment();
    for (const key of ["HEALTH_MODEL_ENDPOINT", "HEALTH_MODEL_API_KEY", "HEALTH_MODEL_SECONDARY_ENDPOINT", "HEALTH_MODEL_SECONDARY_API_KEY"]) vi.stubEnv(key, "");
    const { resetTriageProviderForTest, selectTriageProvider } = await import("@/server/health/provider");
    resetTriageProviderForTest();
    expect(() => selectTriageProvider()).toThrowError(expect.objectContaining({ code: "HEALTH_PROVIDER_CONFIG_PENDING" }));
    resetTriageProviderForTest();
  });

  it("refuses to fall back to a PGlite file database when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { createDatabase } = await import("@/server/db/connection");
    await expect(createDatabase()).rejects.toThrow("DATABASE_URL is required");
  });
});
