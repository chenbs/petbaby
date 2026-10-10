import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGeneration: vi.fn(),
  runNextTask: vi.fn(),
}));

vi.mock("@/server/platform-service", () => ({ createGeneration: mocks.createGeneration, listGenerations: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("00000000-0000-4000-8000-000000000001") }));
vi.mock("@/server/auth/request-guard", () => ({ assertTrustedMutation: vi.fn() }));
vi.mock("@/server/risk/controls", () => ({ assertGenerationCircuit: vi.fn(), clientAddress: vi.fn().mockReturnValue("local"), enforceRateLimit: vi.fn() }));
vi.mock("@/server/worker/generation-worker", () => ({ runNextTask: mocks.runNextTask }));

async function submitGeneration() {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost:3000/api/generations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-petbaby-client": "miniprogram" },
    body: JSON.stringify({ pluginId: "pet-id-card" }),
  }));
}

describe("POST /api/generations worker dispatch", () => {
  beforeEach(() => {
    mocks.createGeneration.mockResolvedValue({ id: "task-id" });
    mocks.runNextTask.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.createGeneration.mockReset();
    mocks.runNextTask.mockReset();
  });

  /*
   * 2026-10-09 起本地与生产走同一条路径：任务只入队，由 `pnpm worker` 处理。
   * 以前文件库 / 内存库会在请求里内联执行，结果是本地能出图而 AI 写真（只入队）永远排队，
   * 两类任务在本地表现不一致，也掩盖了「Worker 没起来」这类生产问题。
   */
  it.each([
    ["development", ""],
    ["development", "memory://"],
    ["development", "file://.data/petbaby"],
    ["development", "postgres://localhost/petbaby"],
    ["production", "postgres://db/petbaby"],
  ])("leaves tasks for the worker (%s, %s)", async (nodeEnv, databaseUrl) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("DATABASE_URL", databaseUrl);
    expect((await submitGeneration()).status).toBe(202);
    expect(mocks.runNextTask).not.toHaveBeenCalled();
  });
});
