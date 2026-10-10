import { defineConfig, devices } from "@playwright/test";

/*
 * 2026-10-09 起 E2E 与生产同构：Web 与 Worker 两个进程共用一个 PostgreSQL，任务只由 Worker 处理。
 * 本地用 `pnpm test:e2e:local`（scripts/local-db.mjs 起库并清空 petbaby_e2e 库）；CI 由服务容器提供 E2E_DATABASE_URL。
 *
 * PETBABY_TEST_HARNESS=1 让夹具保留 demo 用户、开放后台并使用占位图；
 * 外部凭据显式置空 —— next dev 会读 .env.local，而 @next/env 不覆盖进程里已有（含空值）的变量，
 * 这样本地跑 E2E 不会调用 lingsuan / 百炼。
 */
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl?.startsWith("postgres")) {
  throw new Error("E2E_DATABASE_URL must point to a dedicated PostgreSQL database; run `pnpm test:e2e:local` locally");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // All journeys share the demo account, its daily quota and the same database.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: 'concurrently --kill-others "next dev --hostname 127.0.0.1 --port 3100" "node --conditions=react-server --import tsx scripts/worker.ts"',
    env: {
      NODE_ENV: "development",
      PETBABY_TEST_HARNESS: "1",
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: databaseUrl,
      OBJECT_STORAGE_PROVIDER: "local",
      LOCAL_STORAGE_DIR: ".data/e2e-postgres-objects",
      PAYMENT_PROVIDER: "development",
      PHYSICAL_PAYMENT_PROVIDER: "development",
      ADMIN_USER_IDS: "",
      LINGSUAN_IMAGE_BASE_URL: "",
      LINGSUAN_IMAGE_API_KEY: "",
      AI_IMAGE_ENDPOINT: "",
      AI_IMAGE_API_KEY: "",
      AI_IMAGE_SECONDARY_ENDPOINT: "",
      AI_IMAGE_SECONDARY_API_KEY: "",
      HEALTH_MODEL_ENDPOINT: "",
      HEALTH_MODEL_API_KEY: "",
      HEALTH_MODEL_SECONDARY_ENDPOINT: "",
      HEALTH_MODEL_SECONDARY_API_KEY: "",
      WECHAT_APP_SECRET: "",
    },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
