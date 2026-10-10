import "server-only";

import { storeWechatSession } from "@/server/auth/wechat-session";
import { inTransaction } from "@/server/db/client";

export type WechatIdentity = { openid: string; unionid: string; session_key: string };

/**
 * 微信登录即注册（2026-10-09 起以 unionid 为唯一标识）。
 *
 * - 按 unionid 找人，找到就把 openid 更新为本次值（openid 只记录，支付要用）；
 * - 找不到时，接管一次「只有 openid、还没有 unionid」的老微信账号，避免改口径后老用户变成新用户；
 * - 都没有就新建。并发首登靠 unionid 唯一索引 + ON CONFLICT 收敛到同一行。
 *
 * session_key 与用户行在同一事务里落库：会话加密密钥缺失时整个登录回滚，
 * 不会留下一个建了号却永远登不进去的用户。
 */
export async function signInWechatUser(identity: WechatIdentity) {
  return inTransaction(async (database) => {
    const existing = await database.query<{ id: string }>(
      "UPDATE users SET wechat_openid=$2 WHERE wechat_unionid=$1 RETURNING id",
      [identity.unionid, identity.openid],
    );
    let userId = existing[0]?.id;
    if (!userId) {
      const legacy = await database.query<{ id: string }>(
        "UPDATE users SET wechat_unionid=$1 WHERE id=(SELECT id FROM users WHERE wechat_openid=$2 AND wechat_unionid IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1) RETURNING id",
        [identity.unionid, identity.openid],
      );
      userId = legacy[0]?.id;
    }
    if (!userId) {
      const created = await database.query<{ id: string }>(
        "INSERT INTO users (id,wechat_unionid,wechat_openid,created_at) VALUES ($1,$2,$3,now()) ON CONFLICT (wechat_unionid) DO UPDATE SET wechat_openid=EXCLUDED.wechat_openid RETURNING id",
        [crypto.randomUUID(), identity.unionid, identity.openid],
      );
      userId = created[0].id;
    }
    await storeWechatSession(userId, identity.session_key);
    return userId;
  });
}
