import "server-only";

import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

export type SuspensionInput = { action: "suspend" | "reactivate"; userId: string; reason: string };

/**
 * 封禁 / 解封账号（后台用户详情与图片审核共用）。
 *
 * 封禁后：微信登录返回 403（wechat-account.ts），已有会话的请求一律 403 ACCOUNT_SUSPENDED（session.ts），
 * 后台账号同样登不进；作品、纪念空间、年度报告的公开分享立即关闭，解封后不自动恢复。
 * 主动注销与封禁是两回事：已注销的账号不能通过解封复活。
 */
export async function setUserSuspension(actorId: string, input: SuspensionInput) {
  if (input.userId === actorId && input.action === "suspend") throw new AppError("SELF_SUSPEND_FORBIDDEN", "不能封禁当前管理员账号", 409);
  const database = await getDatabase();
  const currentRows = await database.query("SELECT id,deleted_at,admin_suspended_at FROM users WHERE id=$1", [input.userId]);
  if (!currentRows[0]) throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
  if (currentRows[0].deleted_at) throw new AppError("DELETED_ACCOUNT_NOT_REACTIVATABLE", "用户已主动注销，不能通过封禁或解封处理", 409);
  const rows = await database.query(
    `UPDATE users
     SET admin_suspended_at=CASE WHEN $2='suspend' THEN now() ELSE NULL END,
         admin_suspended_by=CASE WHEN $2='suspend' THEN $3::uuid ELSE NULL END,
         admin_suspension_reason=CASE WHEN $2='suspend' THEN $4 ELSE NULL END
     WHERE id=$1 AND deleted_at IS NULL
     RETURNING id,deleted_at,admin_suspended_at,admin_suspension_reason`,
    [input.userId, input.action, actorId, input.reason],
  );
  if (!rows[0]) throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
  if (input.action === "suspend") {
    await Promise.all([
      database.query("UPDATE works SET public=false,share_token=NULL,share_expires_at=NULL,share_access_code_hash=NULL WHERE user_id=$1 AND public=true", [input.userId]),
      database.query("UPDATE memorial_spaces SET visibility='private',share_token=NULL,updated_at=now() WHERE user_id=$1 AND share_token IS NOT NULL", [input.userId]),
      database.query("UPDATE annual_reports SET share_token=NULL,revoked_at=now() WHERE user_id=$1 AND share_token IS NOT NULL", [input.userId]),
    ]);
  }
  await database.query(
    "INSERT INTO audit_logs (id,user_id,actor_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,$3,$4,'user',$5,$6::jsonb,$7)",
    [crypto.randomUUID(), input.userId, actorId, `user_${input.action}`, input.userId, JSON.stringify({ reason: input.reason, before: currentRows[0], after: rows[0] }), new Date()],
  );
  return rows[0];
}
