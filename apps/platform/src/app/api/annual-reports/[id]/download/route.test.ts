import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ query: vi.fn(), get: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-owner") }));
vi.mock("@/server/db/client", () => ({ getDatabase: async () => ({ query: fixture.query }) }));
vi.mock("@/server/storage", () => ({ objectStorage: { get: fixture.get } }));

import { GET } from "./route";

describe("年度报告下载文件格式", () => {
  it.each([
    { contentType: "image/png", extension: "png", body: new Uint8Array([137, 80, 78, 71]) },
    { contentType: "image/svg+xml", extension: "svg", body: new TextEncoder().encode("<svg/>") },
  ])("$contentType 使用与内容一致的扩展名，兼容历史报告", async ({ contentType, extension, body }) => {
    fixture.query.mockResolvedValue([{ year: 2026, locked: false, output_key: "private/report", preview_key: "private/preview" }]);
    fixture.get.mockResolvedValue({ contentType, body });
    const response = await GET(new Request("http://localhost/api/annual-reports/report/download"), { params: Promise.resolve({ id: "report" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(contentType);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename=petbaby-wrapped-2026.${extension}`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  });
});
