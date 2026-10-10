import "server-only";

export type RuntimeMode = "development" | "staging" | "production";

/**
 * 运行模式与 `NODE_ENV` 分离：测试机需要生产构建（真实 PostgreSQL、HTTPS、无 demo 用户兜底），
 * 但允许本地磁盘存储和模拟支付等尚未申请到凭据的适配器。
 * 只有 `NODE_ENV=production` 且 `APP_ENV=staging` 才进入 staging 模式；
 * 正式生产不得设置 `APP_ENV=staging`。
 */
export function runtimeMode(): RuntimeMode {
  if (process.env.NODE_ENV !== "production") return "development";
  return process.env.APP_ENV?.trim().toLowerCase() === "staging" ? "staging" : "production";
}

export function isStaging() {
  return runtimeMode() === "staging";
}

/** 正式生产：所有外部依赖必须使用真实凭据，禁止任何本地/模拟适配器。 */
export function isRealProduction() {
  return runtimeMode() === "production";
}

/**
 * 自动化测试夹具：Vitest（`NODE_ENV=test`）与 Playwright（`PETBABY_TEST_HARNESS=1`）。
 *
 * 2026-10-09 起本地开发与生产功能一致：没有 demo 用户兜底、后台按白名单、
 * 缺凭据的外部依赖明确失败。只有测试夹具还能用占位实现顶替外部依赖、
 * 跳过来源校验、默认开放后台 —— 否则测试无法自足运行。生产构建里该开关无效。
 */
export function isTestHarness() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NODE_ENV === "test" || process.env.PETBABY_TEST_HARNESS === "1";
}
