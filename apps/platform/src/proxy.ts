import { NextResponse, type NextRequest } from "next/server";

// 分享页、法律页和登录页对匿名访客开放；其余页面在生产模式下必须先登录。
// 非生产环境依赖 `getOptionalUserId()` 的 demo 用户兜底，因此直接放行。
const PUBLIC_PREFIXES = ["/login", "/legal", "/share", "/interactive/share", "/memorial/share", "/annual-report/share"];

export default function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return NextResponse.next();
  if (request.cookies.has("petbaby_session")) return NextResponse.next();
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = pathname === "/" ? "" : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(target);
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|manifest.webmanifest).*)"] };
