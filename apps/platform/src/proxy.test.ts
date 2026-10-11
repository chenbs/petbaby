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

it("sends signed-out admin visits to the admin login page, and keeps that page public", () => {
  vi.stubEnv("NODE_ENV", "production");
  const console = proxy(new NextRequest("https://app.example.test/admin/revenue?range=7d"));
  expect(console.status).toBe(307);
  expect(console.headers.get("location")).toContain("/admin/login?next=%2Fadmin%2Frevenue%3Frange%3D7d");
  expect(proxy(new NextRequest("https://app.example.test/admin/login")).status).toBe(200);
  expect(proxy(new NextRequest("https://app.example.test/me")).headers.get("location")).toContain("/login?next=");
});
