import "server-only";

import QRCode from "qrcode";

import { getWechatAccessToken } from "@/server/wechat/access-token";

/*
 * 分享海报上的小程序码。
 *
 * 配齐 WECHAT_APP_ID / WECHAT_APP_SECRET 时（本地与生产同口径）走 wxa/getwxacodeunlimit：scene 最长 32 个可见字符，页面必须是已发布版本里的页面。
 * 未配置 AppSecret 时退回一张普通二维码（指向站内分享地址），保证海报能画出来。
 * 这个回退码在微信里扫不进小程序，只用于开发联调。
 */
const cache = new Map<string, { body: Buffer; contentType: string; expiresAt: number }>();

export async function createShareCode(page: "pages/fun-tests/fun-tests" | "pages/share/share", scene: string, fallbackUrl: string) {
  const key = `${page}|${scene}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit;
  let result: { body: Buffer; contentType: string } | undefined;
  if (process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET) {
    try {
      const token = await getWechatAccessToken();
      const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene: scene.slice(0, 32), page, check_path: false, width: 280, is_hyaline: false }),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") || "";
      // 成功时直接返回图片字节；失败时微信返回 JSON 错误体。
      if (response.ok && contentType.startsWith("image/")) result = { body: Buffer.from(await response.arrayBuffer()), contentType };
    } catch {
      result = undefined;
    }
  }
  if (!result) result = { body: await QRCode.toBuffer(fallbackUrl, { type: "png", margin: 1, width: 280, color: { dark: "#1F2540", light: "#FFFFFF" } }), contentType: "image/png" };
  const entry = { ...result, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  cache.set(key, entry);
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return entry;
}
