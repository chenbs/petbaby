import Link from "next/link";

import { PluginAdminClient } from "@/components/plugin-admin-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export default async function AdminPluginsPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">PLUGIN CONTROL</span><h1>玩法配置与回滚</h1><p>发布会创建不可变历史版本；任务继续使用创建时的配置快照。</p></div><PluginAdminClient /></main>;
}
