import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

import proxy from "./proxy";

afterEach(() => vi.unstubAllEnvs());

it("keeps public test results open while requiring login for the test catalog in production", () => {
  vi.stubEnv("NODE_ENV", "production");
  const shared = proxy(new NextRequest("https://app.example.test/fun-tests/share/abc"));
  const catalog = proxy(new NextRequest("https://app.example.test/fun-tests"));
  expect(shared.status).toBe(200);
  expect(catalog.status).toBe(307);
  expect(catalog.headers.get("location")).toContain("/login");
});
