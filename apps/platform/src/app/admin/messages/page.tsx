import Link from "next/link";
import { Mail } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { FilterBar } from "@/components/admin/filter-bar";
import { Badge, Card, CardBody, CardHeader, EmptyState, Mono, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/admin/ui";
import { statusLabel } from "@/lib/admin-labels";
import { formatCount, formatDateTime } from "@/lib/admin-format";
import { listAnnualReports, listSubscriptions } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "消息与报告" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const EVENT_LABELS: Record<string, string> = {
  generation_ready: "作品完成",
  on_this_day: "去年今日",
  care_due: "疫苗驱虫到期",
  annual_report: "年度报告",
  physical_shipped: "实体单发货",
};

export default async function MessagesPage({ searchParams }: Props) {
  await requireAdminPage("/admin/messages");
  const params = await searchParams;
  const status = typeof params.status === "string" && ["scheduled", "sent", "failed", "closed", "unsubscribed"].includes(params.status) ? params.status : undefined;
  const [subscriptions, reports] = await Promise.all([listSubscriptions(status), listAnnualReports()]);

  return (
    <>
      <PageHeader title="消息与报告" description="微信订阅消息的投递状态，以及年度报告的生成与模板版本。" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {["scheduled", "sent", "failed", "closed", "unsubscribed"].map((key) => (
          <Card key={key} className="px-4 py-3">
            <p className="text-xs text-muted">{statusLabel(key).label}</p>
            <p className={`mt-1 text-xl font-semibold ${key === "failed" && subscriptions.stats[key] ? "text-critical-ink" : "text-ink"}`}>{formatCount(subscriptions.stats[key] || 0)}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="订阅消息"
          description="失败的排在最前；重试会立刻重新进入发送队列"
          actions={<FilterBar action="/admin/messages" placeholder="（按状态筛选）" selects={[{ name: "status", label: "状态", value: status, options: [{ value: "", label: "全部状态" }, ...["scheduled", "sent", "failed", "closed", "unsubscribed"].map((value) => ({ value, label: statusLabel(value).label }))] }]} />}
        />
        <CardBody className="px-0 pb-0">
          {subscriptions.items.length ? (
            <Table>
              <thead><tr><Th>事件</Th><Th>用户</Th><Th>状态</Th><Th align="right">尝试</Th><Th>计划 / 发送时间</Th><Th>最后错误</Th><Th align="right">操作</Th></tr></thead>
              <tbody>
                {subscriptions.items.map((item) => {
                  const closable = !["sent", "unsubscribed", "closed"].includes(String(item.status));
                  return (
                    <Tr key={String(item.id)}>
                      <Td><span className="font-medium">{EVENT_LABELS[String(item.event_type)] || String(item.event_type)}</span>{item.template_code ? <Mono className="ml-2">{String(item.template_code)}</Mono> : null}</Td>
                      <Td><Link href={`/admin/users/${item.user_id}`} className="hover:underline"><Mono>{String(item.user_id).slice(0, 8)}</Mono></Link></Td>
                      <Td><StatusBadge status={item.status} /></Td>
                      <Td align="right">{formatCount(item.attempts as number)}</Td>
                      <Td className="text-ink-2">{formatDateTime((item.sent_at || item.scheduled_at) as string)}</Td>
                      <Td className="max-w-64 truncate text-xs text-critical-ink" title={String(item.last_error || "")}>{String(item.last_error || "")}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          {item.status === "failed" ? <ActionDialog label="重试" title="重试这条订阅消息" endpoint="/api/admin/business" body={{ action: "retry_subscription", id: item.id }} reasonDefault="后台人工重试" success="已重新排队" /> : null}
                          {closable ? <ActionDialog label="关闭" title="关闭这条订阅消息" description="关闭后不会再发送。" endpoint="/api/admin/business" body={{ action: "close_subscription", id: item.id }} reasonDefault="后台关闭异常任务" danger success="已关闭" /> : null}
                          {!closable && item.status !== "failed" ? <span className="text-xs text-muted">—</span> : null}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={Mail} title="没有订阅消息" />}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="年度报告" description="最近 40 份，失败的排在最前" />
          <CardBody className="px-0 pb-0 pt-3">
            {reports.reports.length ? (
              <Table>
                <thead><tr><Th>年份</Th><Th>用户</Th><Th>状态</Th><Th>模板</Th><Th align="right">分享访问</Th><Th>创建</Th><Th align="right">操作</Th></tr></thead>
                <tbody>
                  {reports.reports.map((item) => (
                    <Tr key={String(item.id)}>
                      <Td className="font-medium">{String(item.year)}</Td>
                      <Td><Link href={`/admin/users/${item.user_id}`} className="hover:underline"><Mono>{String(item.user_id).slice(0, 8)}</Mono></Link></Td>
                      <Td><StatusBadge status={item.status} />{item.locked ? <span className="ml-2 text-[11px] text-muted">未解锁</span> : null}</Td>
                      <Td className="text-ink-2">{String(item.template_version || "—")}</Td>
                      <Td align="right">{formatCount(item.visits as number)}</Td>
                      <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                      <Td align="right">{item.status === "failed" ? <ActionDialog label="重试" title={`重试 ${String(item.year)} 年度报告`} endpoint="/api/admin/business" body={{ action: "retry_report", id: item.id }} reasonDefault="后台重试年度报告" success="已重新生成" /> : <span className="text-xs text-muted">—</span>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="px-5 pb-8 pt-2 text-center text-xs text-muted">还没有年度报告</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="报告模板版本"
            actions={<ActionDialog
              label="发布新版本"
              title="发布年度报告模板"
              description="新版本会设为默认，之后生成的报告使用它；已生成的报告不受影响。"
              endpoint="/api/admin/business"
              body={{ action: "create_report_template", status: "active", isDefault: true }}
              fields={[
                { name: "code", label: "模板编码", required: true, defaultValue: "wrapped", maxLength: 80 },
                { name: "label", label: "名称", required: true, defaultValue: "年度回忆录", maxLength: 80 },
                { name: "config", label: "配置 JSON", type: "json", defaultValue: JSON.stringify({ chapters: ["moments", "works", "interactions"] }, null, 2) },
              ]}
              reasonDefault="发布报告模板版本"
              variant="primary"
              success="模板已发布"
            />}
          />
          <CardBody className="pt-3">
            <ul className="divide-y divide-line text-sm">
              {reports.templates.map((item) => (
                <li key={String(item.id)} className="flex items-center justify-between gap-3 py-2.5">
                  <span><span className="font-medium text-ink">{String(item.label)}</span><Mono className="ml-2">{String(item.code)} v{String(item.version)}</Mono></span>
                  <span className="flex items-center gap-2">{item.is_default ? <Badge tone="good">默认</Badge> : null}<StatusBadge status={item.status} /></span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
