/*
 * 本地 PostgreSQL（2026-10-09）。
 *
 * 本地与生产功能一致：Web 与 Worker 是两个进程，共用一个 PostgreSQL。
 * PGlite 文件库同一时间只能被一个进程打开，没法让 `pnpm worker` 连上 `pnpm dev` 正在用的库，
 * 所以本地改用 embedded-postgres 带的 PostgreSQL 17 二进制（与生产 postgres:17 同一大版本），
 * 不依赖 Docker 或系统安装。
 *
 *   node scripts/local-db.mjs start                 起库（首次 initdb），确保 petbaby 库存在，并把 DATABASE_URL / SESSION_SECRET / ADDRESS_ENCRYPTION_KEY 补进 .env.local
 *   node scripts/local-db.mjs stop | status
 *   node scripts/local-db.mjs run [--fresh] <db> -- <command...>
 *                                                   起库并确保 <db> 存在（--fresh 先删后建），带上该库的 DATABASE_URL / E2E_DATABASE_URL 执行命令（E2E 用）
 *
 * 数据目录 .data/pg、密码 .data/pg.secret、日志 .data/pg.log，都在 .gitignore 覆盖的 .data/ 下。
 * 端口默认 54329，可用 LOCAL_PG_PORT 覆盖；只监听 127.0.0.1。
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, ".data", "pg");
const secretFile = path.join(root, ".data", "pg.secret");
const logFile = path.join(root, ".data", "pg.log");
const envFile = path.join(root, ".env.local");
const port = Number(process.env.LOCAL_PG_PORT || 54329);
const user = "petbaby";
const defaultDatabase = "petbaby";

async function binaries() {
  // 平台二进制包是 embedded-postgres 的可选依赖，从它的安装位置解析（pnpm 不会把它提升到顶层）。
  const fromPackage = createRequire(createRequire(import.meta.url).resolve("embedded-postgres"));
  const packageName = { win32: "@embedded-postgres/windows-x64", darwin: `@embedded-postgres/darwin-${process.arch}`, linux: `@embedded-postgres/linux-${process.arch}` }[process.platform];
  if (!packageName) throw new Error(`不支持的平台 ${process.platform}`);
  const entry = fromPackage.resolve(packageName);
  return import(pathToFileURL(entry).href);
}

function password() {
  if (!existsSync(secretFile)) {
    mkdirSync(path.dirname(secretFile), { recursive: true });
    writeFileSync(secretFile, randomBytes(18).toString("base64url"));
  }
  return readFileSync(secretFile, "utf8").trim();
}

export function databaseUrl(database = defaultDatabase) {
  return `postgres://${user}:${encodeURIComponent(password())}@127.0.0.1:${port}/${database}`;
}

/*
 * `detached` 用于 `pg_ctl start`：postgres 常驻进程会继承 pg_ctl 的输出管道，
 * Windows 下 spawnSync 要等管道关闭才返回，于是永远挂住。启动时不接管输出，结果看 pg.log。
 */
function run(binary, args, { detached = false } = {}) {
  const result = spawnSync(binary, args, { encoding: "utf8", windowsHide: true, stdio: detached ? "ignore" : "pipe" });
  return { code: result.status ?? 1, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

async function running() {
  const { pg_ctl } = await binaries();
  return existsSync(path.join(dataDir, "PG_VERSION")) && run(pg_ctl, ["status", "-D", dataDir]).code === 0;
}

async function start() {
  const { pg_ctl, initdb } = await binaries();
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    const pwfile = path.join(tmpdir(), `petbaby-pg-${randomBytes(6).toString("hex")}`);
    writeFileSync(pwfile, `${password()}\n`);
    try {
      const init = run(initdb, [`--pgdata=${dataDir}`, `--username=${user}`, `--pwfile=${pwfile}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-instructions"]);
      if (init.code !== 0) throw new Error(`initdb 失败：\n${init.output}`);
    } finally {
      rmSync(pwfile, { force: true });
    }
  }
  if (!(await running())) {
    const started = run(pg_ctl, ["start", "-D", dataDir, "-l", logFile, "-w", "-t", "60", "-o", `-p ${port} -c listen_addresses=127.0.0.1`], { detached: true });
    if (started.code !== 0) throw new Error(`PostgreSQL 启动失败，详见 ${logFile}：\n${started.output}`);
  }
}

async function ensureDatabase(name, fresh = false) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`库名不合法：${name}`);
  const sql = postgres(databaseUrl("postgres"), { max: 1, onnotice: () => undefined });
  try {
    if (fresh) await sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    const exists = await sql`SELECT 1 FROM pg_database WHERE datname=${name}`;
    if (!exists.length) await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end();
  }
}

/** 只补缺的键，已有的值一律不动（例如用户自己填的 DATABASE_URL）。 */
function ensureEnvLocal(values) {
  const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const missing = Object.entries(values).filter(([key]) => !new RegExp(`^${key}=.+`, "m").test(current));
  if (!missing.length) return [];
  const block = `\n# 由 scripts/local-db.mjs 补充（本地 PostgreSQL 与会话密钥）\n${missing.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
  writeFileSync(envFile, current.replace(/\s*$/, "\n") + block);
  return missing.map(([key]) => key);
}

async function main() {
  const [command = "status", ...rest] = process.argv.slice(2);
  if (command === "start") {
    await start();
    await ensureDatabase(defaultDatabase);
    const added = ensureEnvLocal({ DATABASE_URL: databaseUrl(), SESSION_SECRET: randomBytes(32).toString("base64url"), ADDRESS_ENCRYPTION_KEY: randomBytes(32).toString("base64url") });
    console.log(`PostgreSQL 已就绪：127.0.0.1:${port}/${defaultDatabase}`);
    if (added.length) console.log(`已写入 .env.local：${added.join(", ")}`);
    return;
  }
  if (command === "stop") {
    if (!(await running())) return console.log("PostgreSQL 未在运行");
    const { pg_ctl } = await binaries();
    const stopped = run(pg_ctl, ["stop", "-D", dataDir, "-m", "fast", "-w"]);
    if (stopped.code !== 0) throw new Error(stopped.output);
    return console.log("PostgreSQL 已停止");
  }
  if (command === "status") {
    return console.log((await running()) ? `运行中：127.0.0.1:${port}（数据目录 ${dataDir}）` : "未运行");
  }
  if (command === "run") {
    const fresh = rest[0] === "--fresh";
    const args = fresh ? rest.slice(1) : rest;
    const separator = args.indexOf("--");
    const database = args[0];
    if (!database || separator !== 1 || args.length < 3) throw new Error("用法：node scripts/local-db.mjs run [--fresh] <db> -- <command...>");
    await start();
    await ensureDatabase(database, fresh);
    const line = args.slice(2).map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
    const child = spawn(line, { shell: true, stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl(database), E2E_DATABASE_URL: databaseUrl(database) } });
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
    return;
  }
  throw new Error(`未知命令 ${command}；可用 start | stop | status | run`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
