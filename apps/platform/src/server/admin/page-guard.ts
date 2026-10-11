import "server-only";

import { notFound, redirect } from "next/navigation";

import { isAdmin } from "@/server/auth/admin";
import { getOptionalUserId } from "@/server/auth/session";

/**
 * 后台页面的统一守卫：未登录去后台登录页（/admin/login，与消费端微信登录分开），非管理员 404（不暴露后台存在）。
 * 必须在每个 page 里调用 —— 在 layout 里 notFound() 会越过同段的 not-found 边界，状态码与界面都不可控。
 */
export async function requireAdminPage(path = "/admin") {
  const userId = await getOptionalUserId();
  if (!userId) redirect(`/admin/login?next=${encodeURIComponent(path)}`);
  if (!isAdmin(userId)) notFound();
  return userId;
}
