/*
 * 让 Worker / 迁移脚本与 `next dev` / `next start` 读同一组环境文件（2026-10-09）。
 *
 * 以前 `pnpm worker` 只认进程环境变量，不读 .env.local：本地 Web 连着一个库、Worker 连着另一个库，
 * 任务入队后永远没人处理。这里直接复用 Next 自带的 @next/env，加载顺序与覆盖规则与 Next 完全一致
 * （进程里已有的变量优先）。容器镜像里 .env* 被 .dockerignore 排除，生产仍只认 compose 注入的变量。
 *
 * 必须是入口文件的第一条 import：provider 等模块在加载时就读取环境变量。
 */
import { createRequire } from "node:module";
import path from "node:path";

const fromApp = createRequire(path.join(process.cwd(), "package.json"));
const fromNext = createRequire(fromApp.resolve("next/package.json"));
const { loadEnvConfig } = fromNext("@next/env") as { loadEnvConfig: (dir: string, dev?: boolean) => unknown };

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
