import Link from "next/link";

import { requireUserId } from "@/server/auth/session";
import { assertAdminPage } from "@/server/auth/admin";
import { inspectConfiguration } from "@/server/config";
import { AdminOperationsClient } from "@/components/admin-operations-client";
import { AdminDashboardClient } from "@/components/admin-dashboard-client";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const userId = await requireUserId();
  assertAdminPage(userId);
  const configuration = inspectConfiguration();
  return (
    <main className="screen">
      <div className="page-heading">
        <Link className="back-link" href="/me">← 返回我的</Link>
        <span className="eyebrow">MONDAY REVIEW</span>
        <h1>运营诊断台</h1>
        <p>统一处理漏斗、任务、订单，以及 AI Provider 成本、故障与熔断。</p>
      </div>
      <div className="button-row"><Link className="secondary-button" href="/admin/experiments">玩法赛马后台</Link><Link className="secondary-button" href="/admin/plugins">玩法配置与回滚</Link><Link className="secondary-button" href="/admin/interactive">互动会话与导出</Link><Link className="secondary-button" href="/admin/video">视频模板与任务</Link><Link className="secondary-button" href="/admin/memorials">纪念产品管理</Link><Link className="secondary-button" href="/admin/business">阶段三履约与权益</Link><Link className="secondary-button" href="/admin/users">用户管理</Link><Link className="secondary-button" href="/admin/audit">统一审计</Link></div>
      <section className="panel" style={{ marginTop: 20 }}><div className="section-heading"><div><span className="eyebrow">CONFIGURATION</span><h2>环境配置诊断</h2><p>运行模式：{configuration.mode === "production" ? "正式生产" : configuration.mode === "staging" ? "测试机（staging）" : "本地开发"}</p></div><b>{configuration.productionReady ? "可上线" : "仍有待补项"}</b></div><div className="settings-list">{configuration.checks.map((check) => <div key={check.key}><span><b>{check.key}</b><small style={{ display: "block" }}>{check.hint}</small></span><span>{check.configured ? "已配置" : check.required ? "必填缺失" : "开发可选"}</span></div>)}</div></section>
      <AdminDashboardClient />
      <AdminOperationsClient />
    </main>
  );
}
