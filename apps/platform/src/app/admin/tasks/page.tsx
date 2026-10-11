import Link from "next/link";
import { ListChecks } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { FilterBar } from "@/components/admin/filter-bar";
import { Card, EmptyState, Mono, PageHeader, Pagination, SegmentLinks, StatusBadge, Table, Td, Th, Tr, withQuery } from "@/components/admin/ui";
import { statusLabel } from "@/lib/admin-labels";
import { formatCount, formatDateTime, formatRelative } from "@/lib/admin-format";
import { listTasks, taskHealth, type TaskKind } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "任务监控" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const KINDS: Array<{ key: TaskKind; label: string }> = [
  { key: "image", label: "创意照片" },
  { key: "layout", label: "排版玩法" },
  { key: "video", label: "短片渲染" },
];

const STATUS_OPTIONS: Record<TaskKind, string[]> = {
  image: ["queued", "processing", "succeeded", "failed", "cancelled"],
  layout: ["queued", "processing", "succeeded", "failed"],
  video: ["queued", "processing", "preview_ready", "ready", "failed", "cancelled", "retried"],
};

const VIDEO_KIND_LABELS: Record<string, string> = { "annual-film": "年度短片", memory: "记忆短片" };

/** 每类任务能做的人工操作，对应既有接口的状态约束（不满足时接口返回 409）。 */
function taskActions(kind: TaskKind, item: Record<string, unknown>) {
  const status = String(item.status);
  if (kind === "image" && status === "failed") return { label: "重试", endpoint: "/api/admin/operations", method: "POST" as const, body: { action: "retry_ai", runId: item.id }, success: "已重新排队" };
  if (kind === "image" && ["queued", "processing"].includes(status)) return { label: "取消", endpoint: "/api/admin/operations", method: "POST" as const, body: { action: "cancel_ai", runId: item.id }, success: "任务已取消", danger: true };
  if (kind === "layout" && status === "failed") return { label: "重试", endpoint: "/api/admin/operations", method: "POST" as const, body: { action: "retry_task", taskId: item.id }, success: "已重新排队" };
  if (kind === "video" && ["failed", "cancelled"].includes(status)) return { label: "重试", endpoint: "/api/admin/video", method: "PATCH" as const, body: { resource: "render", action: "retry", id: item.id }, success: "已重新排队" };
  if (kind === "video" && ["queued", "processing", "preview_ready"].includes(status)) return { label: "取消", endpoint: "/api/admin/video", method: "PATCH" as const, body: { resource: "render", action: "cancel", id: item.id }, success: "渲染已取消", danger: true };
  return null;
}

export default async function TasksPage({ searchParams }: Props) {
  await requireAdminPage("/admin/tasks");
  const params = await searchParams;
  const kind = (KINDS.some((item) => item.key === one(params.kind)) ? one(params.kind) : "image") as TaskKind;
  const status = STATUS_OPTIONS[kind].includes(one(params.status) || "") ? one(params.status) : undefined;
  const q = one(params.q)?.slice(0, 120);
  const page = Number(one(params.page) || 1);
  const [result, health] = await Promise.all([listTasks({ kind, status, q, page }), taskHealth()]);
  const href = (next: Record<string, string | number | undefined>) => withQuery("/admin/tasks", { kind, status, q, ...next });

  return (
    <>
      <PageHeader title="任务监控" description="生成队列的实时状态。失败任务会自动重试两次，仍失败则退还冻干；这里处理需要人工介入的部分。" />

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        {KINDS.map((item) => {
          const counts = health.byKind[item.key] || {};
          return (
            <Card key={item.key} className="px-5 py-4">
              <div className="flex items-center justify-between"><p className="text-sm font-medium text-ink">{item.label}</p><span className="text-[11px] text-muted">近 24 小时 + 在途</span></div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[["queued", "排队"], ["processing", "处理中"], [item.key === "video" ? "ready" : "succeeded", "成功"], ["failed", "失败"]].map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-[11px] text-muted">{label}</dt>
                    <dd className={`mt-0.5 text-lg font-semibold tnum ${key === "failed" && counts[key] ? "text-critical-ink" : "text-ink"}`}>{formatCount((counts[key] || 0) + (key === "ready" ? counts.preview_ready || 0 : 0))}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentLinks label="任务类型" active={kind} items={KINDS.map((item) => ({ key: item.key, label: item.label, href: withQuery("/admin/tasks", { kind: item.key }) }))} />
        <FilterBar
          action="/admin/tasks"
          q={q}
          placeholder="任务 ID、用户 ID、错误码、模板"
          hidden={{ kind }}
          selects={[{ name: "status", label: "状态", value: status, options: [{ value: "", label: "全部状态" }, ...STATUS_OPTIONS[kind].map((value) => ({ value, label: statusLabel(value).label }))] }]}
        />
      </div>

      <Card>
        {result.items.length ? (
          <>
            <Table>
              <thead><tr><Th>任务</Th><Th>用户</Th><Th>玩法 / 模板</Th><Th>状态</Th><Th align="right">尝试</Th><Th>创建</Th><Th align="right">操作</Th></tr></thead>
              <tbody>
                {result.items.map((item) => {
                  const action = taskActions(kind, item);
                  const detail = kind === "video" ? VIDEO_KIND_LABELS[String(item.detail)] || String(item.detail) : String(item.detail || "");
                  return (
                    <Tr key={String(item.id)}>
                      <Td><Mono>{String(item.id).slice(0, 8)}</Mono>{item.in_bundle ? <span className="ml-2 text-[11px] text-muted">写真套餐</span> : null}</Td>
                      <Td><Link href={`/admin/users/${item.user_id}`} className="hover:underline">{String(item.display_name || "未命名用户")}</Link></Td>
                      <Td><span className="text-ink">{String(item.plugin_name)}</span>{detail ? <span className="mt-0.5 block text-xs text-muted">{detail}</span> : null}</Td>
                      <Td>
                        <StatusBadge status={item.status} />
                        {item.error_code ? <span className="mt-1 block"><Mono className="text-critical-ink">{String(item.error_code)}</Mono></span> : null}
                        {item.status === "processing" && item.locked_at ? <span className="mt-1 block text-[11px] text-muted">锁定于 {formatRelative(item.locked_at as string)}</span> : null}
                      </Td>
                      <Td align="right">{formatCount(item.attempt as number)}{Number(item.retry_count) ? <span className="block text-[11px] text-muted">人工重试 {String(item.retry_count)}</span> : null}</Td>
                      <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                      <Td align="right">
                        {action ? <ActionDialog label={action.label} title={`${action.label}任务 ${String(item.id).slice(0, 8)}`} description={action.label === "重试" ? "任务会重新进入队列，由 Worker 处理；不会重复扣冻干。" : "取消后任务不会再执行。"} endpoint={action.endpoint} method={action.method} body={action.body} danger={action.danger} success={action.success} reasonDefault={action.label === "重试" ? "人工重试" : "人工取消"} /> : <span className="text-xs text-muted">—</span>}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(next) => href({ page: next })} />
          </>
        ) : <EmptyState icon={ListChecks} title="没有符合条件的任务" />}
      </Card>
    </>
  );
}
