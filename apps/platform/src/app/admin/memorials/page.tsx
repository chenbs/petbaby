import Link from "next/link";

import { MemorialAdminClient } from "@/components/memorial-admin-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function MemorialAdminPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">MEMORIAL OPERATIONS</span><h1>纪念产品管理</h1><p>维护主题、模板和生成任务，不直接改写用户故事。</p></div><MemorialAdminClient /></main>;
}
