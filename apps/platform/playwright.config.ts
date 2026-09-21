import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
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
    command: process.env.E2E_DATABASE_URL
      ? 'concurrently --kill-others "next dev --hostname 127.0.0.1 --port 3100" "node --conditions=react-server --import tsx scripts/worker.ts"'
      : "next dev --hostname 127.0.0.1 --port 3100",
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL || "memory://",
      OBJECT_STORAGE_PROVIDER: "local",
      LOCAL_STORAGE_DIR: process.env.E2E_DATABASE_URL ? ".data/e2e-postgres-objects" : ".data/e2e-memory-objects",
      PAYMENT_PROVIDER: "development",
    },
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
