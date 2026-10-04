import { routeError } from "@/server/errors";
import { getPublicFunTestResult } from "@/server/fun-test-service";
import { createShareCode } from "@/server/wechat/wxacode";

/*
 * 趣测分享海报上的小程序码。scene 直接用 32 位分享 token（微信 scene 上限正好 32 字符），
 * 扫码后进入 pages/fun-tests/fun-tests，页面从 query.scene 取回 token。
 * 先校验 token 有效，避免给已删除的结果签发小程序码。
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    await getPublicFunTestResult(token);
    const code = await createShareCode("pages/fun-tests/fun-tests", token, new URL(`/fun-tests/share/${token}`, request.url).toString());
    return new Response(new Uint8Array(code.body), { headers: { "Content-Type": code.contentType, "Cache-Control": "public, max-age=3600" } });
  } catch (error) { return routeError(error); }
}
