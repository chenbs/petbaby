import "server-only";

import { z } from "zod";

import { AppError } from "@/server/errors";

const responseSchema = z.object({ openid: z.string().min(8), session_key: z.string().min(8) });

export async function exchangeWechatCode(code: string) {
  const appId = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appId || !secret) {
    throw new AppError("WECHAT_CONFIG_PENDING", "微信登录配置尚未补齐", 503);
  }
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new AppError("WECHAT_LOGIN_FAILED", "微信登录暂时不可用", 502);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError("WECHAT_LOGIN_FAILED", "微信登录凭证无效", 401);
  return parsed.data;
}
