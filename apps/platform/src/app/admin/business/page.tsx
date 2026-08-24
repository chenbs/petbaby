import Link from "next/link";

import { BusinessAdminClient } from "@/components/business-admin-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function BusinessAdminPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">STAGE 3 OPERATIONS</span><h1>订阅、履约与权益</h1><p>筛选待发送提醒、实体订单、会员续费和年度报告。</p></div><BusinessAdminClient /></main>;
}
