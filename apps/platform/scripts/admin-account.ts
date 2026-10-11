/*
 * 创建运营后台管理员账号，或给已有账号重设密码（2026-10-11）。
 *
 *   pnpm admin:account <账号名> [显示名]      密码从标准输入读第一行（不出现在命令行与 shell 历史里）
 *
 * 成功后打印 `ADMIN_USER_ID=<uuid>`。白名单不在这里改：本地把 id 填进 .env.local 的 ADMIN_USER_IDS，
 * 服务器上用 deploy/scripts/create-admin.sh（它会调用本脚本并写环境文件、重启服务）。
 */
import "./load-env";
import { upsertAdminAccount } from "../src/server/admin/account";
import { getDatabase } from "../src/server/db/client";

async function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (process.stdin.isTTY) process.stderr.write("输入密码（至少 10 位，含字母和数字），回车结束：");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
    if (Buffer.concat(chunks).includes(10)) break;
  }
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0];
}

async function main() {
  const [accountName, displayName] = process.argv.slice(2);
  if (!accountName) throw new Error("用法：pnpm admin:account <账号名> [显示名]，密码从标准输入读取");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const password = await readPassword();
  const result = await upsertAdminAccount({ accountName, password, displayName });
  process.stderr.write(`${result.created ? "已创建" : "已重设密码"}：${result.accountName}\n`);
  process.stdout.write(`ADMIN_USER_ID=${result.userId}\n`);
  await (await getDatabase()).close();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
