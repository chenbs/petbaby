import "server-only";

import { ACCOUNT_SUSPENDED_MESSAGE } from "@/server/auth/session";
import { storeWechatSession } from "@/server/auth/wechat-session";
import { inTransaction } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { applyAcquisition, type LaunchAttribution } from "@/server/invite-service";

export type WechatIdentity = { openid: string; session_key: string };

/**
 * 微信登录即注册（2026-10-25 起以当前小程序的 openid 为唯一标识，不绑定开放平台）。
 *
 * 按 openid 找人，找不到就新建。并发首登靠 openid 唯一索引 + ON CONFLICT 收敛到同一行。
 * 注销会清空 openid，所以同一个微信注销后再登录得到新账号；见面礼与邀请奖励另按 openid 流水防重复。
 * 后台封禁的账号拒绝登录（403），不签发会话；封禁只能由后台解封。
 *
 * session_key 与用户行在同一事务里落库：会话加密密钥缺失时整个登录回滚，
 * 不会留下一个建了号却永远登不进去的用户。
 */
export async function signInWechatUser(identity: WechatIdentity, attribution?: LaunchAttribution) {
  return inTransaction(async (database) => {
    const existing = await database.query<{ id: string; suspended: boolean }>(
      "SELECT id, admin_suspended_at IS NOT NULL suspended FROM users WHERE wechat_openid=$1",
      [identity.openid],
    );
    if (existing[0]?.suspended) throw new AppError("ACCOUNT_SUSPENDED", ACCOUNT_SUSPENDED_MESSAGE, 403);
    let userId = existing[0]?.id;
    if (!userId) {
      const created = await database.query<{ id: string; inserted: boolean }>(
        "INSERT INTO users (id,wechat_openid,created_at) VALUES ($1,$2,now()) ON CONFLICT (wechat_openid) DO UPDATE SET wechat_openid=EXCLUDED.wechat_openid RETURNING id, (xmax = 0) AS inserted",
        [crypto.randomUUID(), identity.openid],
      );
      userId = created[0].id;
      if (created[0].inserted) await applyAcquisition(database, userId, attribution);
    }
    await storeWechatSession(userId, identity.session_key);
    return userId;
  });
}
