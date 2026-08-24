import { afterEach, describe, expect, it, vi } from "vitest";

import { assertAdmin, isAdmin } from "@/server/auth/admin";

const ADMIN = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-0000000000bb";

describe("administrator authorization", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns a stable not-found error for non-admin API callers in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", ADMIN);
    expect(isAdmin(ADMIN)).toBe(true);
    expect(isAdmin(USER)).toBe(false);
    expect(() => assertAdmin(USER)).toThrowError(expect.objectContaining({ code: "ADMIN_NOT_FOUND", status: 404 }));
  });
});
