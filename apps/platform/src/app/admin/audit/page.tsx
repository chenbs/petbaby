import Link from "next/link";

import { AdminAuditClient } from "@/components/admin-audit-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">AUDIT TRAIL</span><h1>统一管理审计</h1><p>检索插件、赛马、任务、履约、权益、报告和用户操作的统一记录。</p></div><AdminAuditClient /></main>;
}
