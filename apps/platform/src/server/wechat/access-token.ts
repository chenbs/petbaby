import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { requiredPaymentConfig } from "@/server/payments/config";

let cached: { appId: string; value: string; expiresAt: number } | undefined;
let pending: Promise<string> | undefined;

export async function getWechatAccessToken(): Promise<string> {
  const appId = requiredPaymentConfig("WECHAT_APP_ID");
  if (cached?.appId === appId && cached.expiresAt > Date.now()) return cached.value;
  pending ??= (async () => {
    const response = await fetch("https://api.weixin.qq.com/cgi-bin/stable_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credential", appid: appId, secret: requiredPaymentConfig("WECHAT_APP_SECRET") }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
      redirect: "error",
    });
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).safeParse(await response.json());
    if (!response.ok || !parsed.success) throw new AppError("WECHAT_TOKEN_FAILED", "微信服务凭证暂不可用", 502);
    cached = { appId, value: parsed.data.access_token, expiresAt: Date.now() + Math.max(1, parsed.data.expires_in - 120) * 1000 };
    return cached.value;
  })();
  try { return await pending; } finally { pending = undefined; }
}
