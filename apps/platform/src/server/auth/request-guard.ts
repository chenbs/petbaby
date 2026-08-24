import "server-only";

import { AppError } from "@/server/errors";

export function assertTrustedOrigin(request: Request) {
  if (request.headers.get("x-petbaby-client") === "miniprogram") return;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) {
    if (process.env.NODE_ENV === "production") throw new AppError("ORIGIN_REQUIRED", "缺少请求来源", 403);
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("ORIGIN_INVALID", "请求来源无效", 403);
  }
  if (originHost !== host) throw new AppError("ORIGIN_MISMATCH", "拒绝跨站请求", 403);
}

export function assertTrustedMutation(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "请求必须使用 JSON", 415);
  }
  assertTrustedOrigin(request);
}
