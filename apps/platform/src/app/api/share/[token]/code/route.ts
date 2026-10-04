import { routeError } from "@/server/errors";
import { getSharedWork } from "@/server/platform-service";
import { createShareCode } from "@/server/wechat/wxacode";

/** 作品分享海报上的小程序码。scene 为 32 位分享 token，扫码进入 pages/share/share。 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    await getSharedWork(token, new URL(request.url).searchParams.get("code") || undefined);
    const code = await createShareCode("pages/share/share", token, new URL(`/share/${token}`, request.url).toString());
    return new Response(new Uint8Array(code.body), { headers: { "Content-Type": code.contentType, "Cache-Control": "private, max-age=3600" } });
  } catch (error) { return routeError(error); }
}
