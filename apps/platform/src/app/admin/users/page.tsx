import Link from "next/link";

import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";
import { AdminUsersClient } from "@/components/admin-users-client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">PEOPLE / AUDIT</span><h1>用户与审计</h1><p>检索用户、处理账号状态，并为每次人工操作留下可追溯原因。</p></div><AdminUsersClient /></main>;
}
