import Link from "next/link";

import { InteractiveAdminClient } from "@/components/interactive-admin-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function InteractiveAdminPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">INTERACTIVE OPERATIONS</span><h1>互动会话与服务端导出</h1><p>查看互动输入快照、分享状态、访问事件和 15 秒视频导出任务。</p></div><InteractiveAdminClient /></main>;
}
