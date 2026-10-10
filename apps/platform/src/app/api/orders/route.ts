import { routeError } from "@/server/errors";
import { createOrder } from "@/server/platform-service";
import { assertTrustedMutation } from "@/server/auth/request-guard";

/**
 * 作品现金下单已下线（2026-10-08）：作品一律先扣冻干再生成，旧锁定作品走 POST /api/works/[id]/unlock。
 * 保留这条路由只为给旧客户端一个明确的 410，而不是 404。
 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    return Response.json({ data: await createOrder() });
  } catch (error) {
    return routeError(error);
  }
}
