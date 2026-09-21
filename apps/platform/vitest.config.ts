import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    /*
     * 默认 5 秒不够。这套用例走真实 PGlite + 真实 sharp 光栅化：
     * 最重的几条（纪念册多页 PDF、定价分档端到端）本身就要 1.5–6 秒，
     * 而 `--coverage` 的 v8 插桩会再放大约 3 倍 —— 于是出现
     * **「`pnpm test` 全过、`pnpm test:coverage` 挂三条」**，
     * 而失败信息是 5000ms 超时，完全不提插桩，很容易误判成死锁或真实缺陷。
     *
     * 取 30 秒：够最慢那条（覆盖率下约 20 秒）留出余量，又不至于让真的挂住的用例
     * 拖满整轮。**不要用「跳过慢用例」或「只在 CI 放宽」来绕** ——
     * 这几条覆盖的正是PDF 页数与价格分档，是不能不验的东西。
     */
    testTimeout: 30_000,
    /*
     * 钩子也要放宽，且**不能只放 `testTimeout`**：那个管不到 `beforeEach`。
     * 这些用例的 `beforeEach` 要 `resetDatabaseForTest()`（TRUNCATE 三十余张表 +
     * 重跑最后一个迁移）再灌种子数据，覆盖率插桩下会超过默认的 10 秒 ——
     * 失败信息是 `Hook timed out in 10000ms`，同样不提插桩。
     */
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/domain/**/*.ts",
        "src/plugins/**/*.ts",
        "src/server/errors.ts",
        "src/server/platform-service.ts",
        "src/server/growth-service.ts",
        "src/server/payments/**/*.ts",
        "src/server/auth/request-guard.ts",
        "src/server/storage/index.ts",
        "src/server/worker/generation-worker.ts",
        // 2026-08-03 改造新增。健康分诊的红线（药物过滤、四档升级条件）
        // 必须有覆盖率兜住 —— 这些分支漏测的后果是给出致害建议。
        "src/server/health/triage.ts",
        "src/server/health-service.ts",
        "src/server/entitlements.ts",
        "src/server/media/ai-label.ts",
        /*
         * 2026-08-04 第二轮第三批新增，同样是红线所在：
         * - reminders.ts 的 memorial 排除（红线 10）—— 已离开的宠物收到
         *   体检提醒是这条线最不可接受的错误；
         * - document.ts 的「不给结论」—— 这份 PDF 会被打印带去医院，
         *   如果它读起来像诊断结论，误导代价比页面措辞失误大得多。
         */
        "src/server/health/reminders.ts",
        "src/server/health/document.ts",
      ],
      thresholds: { lines: 75, functions: 75, branches: 65, statements: 75 },
    },
  },
});
