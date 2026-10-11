import { redirect } from "next/navigation";

import { AdminLoginForm } from "@/components/admin/login-form";
import { isAdmin } from "@/server/auth/admin";
import { getOptionalUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "登录" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 只允许跳回后台内部路径，防止 ?next= 被拿来做开放重定向。 */
function safeNext(value: string | string[] | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith("/admin") && !next.startsWith("/admin/login") && !next.includes("//") ? next : "/admin";
}

export default async function AdminLoginPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).next);
  const userId = await getOptionalUserId();
  if (userId && isAdmin(userId)) redirect(next);
  return <AdminLoginForm next={next} />;
}
