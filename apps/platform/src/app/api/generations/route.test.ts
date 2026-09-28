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

  it("runs file-backed PGlite tasks in the development server process", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "file://.data/local-preview-petbaby");
    expect((await submitGeneration()).status).toBe(202);
    expect(mocks.runNextTask).toHaveBeenCalledOnce();
  });

  it("leaves PostgreSQL tasks for the separate worker", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/petbaby");
    expect((await submitGeneration()).status).toBe(202);
    expect(mocks.runNextTask).not.toHaveBeenCalled();
  });

  it("does not run a file-backed worker inline in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "file://.data/petbaby");
    expect((await submitGeneration()).status).toBe(202);
    expect(mocks.runNextTask).not.toHaveBeenCalled();
  });
});
