import Link from "next/link";
import { ScrollText } from "lucide-react";

import { FilterBar } from "@/components/admin/filter-bar";
import { Card, EmptyState, Mono, PageHeader, Pagination, Table, Td, Th, Tr, withQuery } from "@/components/admin/ui";
import { AUDIT_TARGET_LABELS, auditActionLabel } from "@/lib/admin-labels";
import { formatDateTime } from "@/lib/admin-format";
import { auditTargetTypes, listAudit } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "审计日志" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditPage({ searchParams }: Props) {
  await requireAdminPage("/admin/audit");
  const params = await searchParams;
  const q = one(params.q)?.slice(0, 120);
  const targetType = one(params.targetType)?.slice(0, 80);
  const page = Number(one(params.page) || 1);
  const [result, types] = await Promise.all([listAudit({ q, targetType, page }), auditTargetTypes()]);

  return (
    <>
      <PageHeader title="审计日志" description="后台每一次改数据的操作：谁、什么时候、对什么、为什么，以及改动前后的状态。" />
      <FilterBar
        className="mb-4"
        action="/admin/audit"
        q={q}
        placeholder="动作、对象 ID、原因"
        selects={[{ name: "targetType", label: "对象", value: targetType, options: [{ value: "", label: "全部对象" }, ...types.map((type) => ({ value: type, label: AUDIT_TARGET_LABELS[type] || type }))] }]}
      />
      <Card>
        {result.items.length ? (
          <>
            <Table>
              <thead><tr><Th>时间</Th><Th>动作</Th><Th>对象</Th><Th>操作人</Th><Th>原因</Th><Th>前后状态</Th></tr></thead>
              <tbody>
                {result.items.map((item) => {
                  const metadata = (typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata || {}) as { reason?: string; before?: unknown; after?: unknown };
                  const diff = metadata.before || metadata.after ? JSON.stringify({ before: metadata.before ?? null, after: metadata.after ?? null }, null, 2) : "";
                  return (
                    <Tr key={String(item.id)}>
                      <Td className="whitespace-nowrap text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                      <Td><span className="font-medium">{auditActionLabel(item.action)}</span><Mono className="ml-2">{String(item.action)}</Mono></Td>
                      <Td>
                        <span className="text-ink">{AUDIT_TARGET_LABELS[String(item.target_type)] || String(item.target_type)}</span>
                        {item.user_id ? <Link href={`/admin/users/${item.user_id}`} className="ml-2 hover:underline"><Mono>{String(item.target_id || item.user_id).slice(0, 8)}</Mono></Link> : item.target_id ? <Mono className="ml-2">{String(item.target_id).slice(0, 12)}</Mono> : null}
                      </Td>
                      <Td className="text-ink-2">{String(item.actor_name || "") || (item.actor_id ? <Mono>{String(item.actor_id).slice(0, 8)}</Mono> : "系统")}</Td>
                      <Td className="max-w-72 truncate" title={metadata.reason}>{metadata.reason || "—"}</Td>
                      <Td>
                        {diff ? (
                          <details className="group">
                            <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">查看</summary>
                            <pre className="scrollbar-thin mt-2 max-h-72 max-w-[480px] overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink-2">{diff}</pre>
                          </details>
                        ) : <span className="text-xs text-muted">—</span>}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(next) => withQuery("/admin/audit", { q, targetType, page: next })} />
          </>
        ) : <EmptyState icon={ScrollText} title="没有符合条件的审计记录" />}
      </Card>
    </>
  );
}
