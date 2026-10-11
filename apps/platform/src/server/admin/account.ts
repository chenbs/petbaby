import "server-only";

import { assertPasswordStrength, hashPassword, normalizeAccountName } from "@/server/auth/password";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

/*
 * 管理员账号的创建与重设密码，只给运维脚本 scripts/admin-account.ts 用。
 * 单独成模块：不能引 server/auth/admin.ts —— 它依赖 next/navigation，在 Next 之外的 Node 脚本里加载会直接报错。
 */

/**
 * 创建管理员账号，或给已有账号重设密码。只给运维脚本用。
 * 白名单（ADMIN_USER_IDS）由部署脚本另外写入环境变量，这里不改。
 */
export async function upsertAdminAccount(input: { accountName: string; password: string; displayName?: string }) {
  const accountName = normalizeAccountName(input.accountName);
  assertPasswordStrength(input.password);
  const database = await getDatabase();
  const passwordHash = await hashPassword(input.password);
  const existing = await database.query<{ id: string; deleted_at: Date | null }>("SELECT id, deleted_at FROM users WHERE lower(account_name)=lower($1)", [accountName]);
  if (existing[0]) {
    if (existing[0].deleted_at) throw new AppError("ACCOUNT_DELETED", "该账号已注销，请换一个账号名", 409);
    await database.query("UPDATE users SET password_hash=$2, password_updated_at=now() WHERE id=$1", [existing[0].id, passwordHash]);
    return { userId: existing[0].id, accountName, created: false };
  }
  const userId = crypto.randomUUID();
  await database.query(
    "INSERT INTO users (id, account_name, password_hash, password_updated_at, display_name, created_at) VALUES ($1,$2,$3,now(),$4,now())",
    [userId, accountName, passwordHash, input.displayName?.trim().slice(0, 40) || accountName],
  );
  return { userId, accountName, created: true };
}
