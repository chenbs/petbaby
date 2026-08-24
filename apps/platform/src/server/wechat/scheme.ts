import "server-only";

import { AppError } from "@/server/errors";

export async function createMiniProgramScheme(pluginId: string, sourceWorkId?: string) {
  const query = new URLSearchParams({ pluginId });
  if (sourceWorkId) query.set("sourceWorkId", sourceWorkId);
  if (process.env.NODE_ENV !== "production") return `/create/${pluginId}?ref=share${sourceWorkId ? `&sourceWorkId=${sourceWorkId}` : ""}`;
  const appid = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) throw new AppError("WECHAT_SCHEME_CONFIG_PENDING", "微信小程序 Scheme 配置尚未完成", 503);
  const tokenResponse = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`);
  const tokenPayload = await tokenResponse.json() as { access_token?: string; errmsg?: string };
  if (!tokenPayload.access_token) throw new AppError("WECHAT_ACCESS_TOKEN_FAILED", tokenPayload.errmsg || "无法获取微信访问令牌", 502);
  const response = await fetch(`https://api.weixin.qq.com/wxa/generatescheme?access_token=${encodeURIComponent(tokenPayload.access_token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jump_wxa: { path: "pages/create/create", query: query.toString() }, expire_type: 1, expire_interval: 7 }) });
  const payload = await response.json() as { openlink?: string; errmsg?: string };
  if (!payload.openlink) throw new AppError("WECHAT_SCHEME_FAILED", payload.errmsg || "小程序 Scheme 生成失败", 502);
  return payload.openlink;
}
