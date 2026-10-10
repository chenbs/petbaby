import { NextResponse, type NextRequest } from "next/server";

// 分享页、法律页和登录页对匿名访客开放；其余页面在生产模式下必须先登录。
// 本地开发与生产同口径（2026-10-09）；只有自动化测试夹具依赖 demo 用户兜底，因此直接放行。
// proxy 不引 runtime-mode（它带 server-only），判断与 isTestHarness() 保持一致。
function testHarness() {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NODE_ENV === "test" || process.env.PETBABY_TEST_HARNESS === "1";
}
const PUBLIC_PREFIXES = ["/login", "/legal", "/share", "/memorial/share", "/annual-report/share", "/fun-tests/share"];

export default function proxy(request: NextRequest) {
  if (testHarness()) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  if (request.cookies.has("petbaby_session")) return NextResponse.next();
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = pathname === "/" ? "" : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(target);
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)"] };
