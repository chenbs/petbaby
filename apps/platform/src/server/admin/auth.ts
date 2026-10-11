import "server-only";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import { isAdmin } from "@/server/auth/admin";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

/*
 * 运营后台的账号密码登录（2026-10-11）。
 *
 * 与消费端分开：小程序与 H5 的普通用户只有微信账号（生产里 passwordAuthEnabled() 恒为 false），
 * 后台管理员用这条独立链路登录，生产同样可用。只放行 ADMIN_USER_IDS 白名单里的账号；
 * 账号不存在、密码错、不是管理员、已停用一律返回同一个错误，不让外部探测哪些账号是管理员。
 * 管理员账号只能由运维脚本创建（scripts/admin-account.ts → ./account.ts），没有公开注册入口。
 */

let dummyHash: Promise<string> | undefined;

/** 账号不存在时也跑一次 scrypt，避免靠响应时间判断账号是否存在。 */
function placeholderHash() {
  dummyHash ??= hashPassword("petbaby-admin-placeholder-0");
  return dummyHash;
}

const INVALID = () => new AppError("INVALID_CREDENTIALS", "账号或密码不正确", 401);

export async function loginAdmin(input: { accountName: string; password: string }) {
  const accountName = input.accountName.trim();
  const rows = await (await getDatabase()).query<{ id: string; password_hash: string | null; deleted_at: Date | null; admin_suspended_at: Date | null }>(
    "SELECT id, password_hash, deleted_at, admin_suspended_at FROM users WHERE lower(account_name)=lower($1)",
    [accountName],
  );
  const user = rows[0];
  const matched = await verifyPassword(input.password, user?.password_hash || await placeholderHash());
  if (!user || !user.password_hash || !matched) throw INVALID();
  if (user.deleted_at || user.admin_suspended_at || !isAdmin(user.id)) throw INVALID();
  return { userId: user.id, accountName };
}
