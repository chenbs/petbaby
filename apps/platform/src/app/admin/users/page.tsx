import Link from "next/link";
import { Users } from "lucide-react";

import { FilterBar } from "@/components/admin/filter-bar";
import { Badge, Card, EmptyState, Mono, PageHeader, Pagination, SegmentLinks, Table, Td, Th, Tr, withQuery } from "@/components/admin/ui";
import { formatCount, formatDate, formatRelative, formatYuan } from "@/lib/admin-format";
import { listUsers, type UserFilter } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "用户" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SEGMENTS = [
  { key: "all", label: "全部" },
  { key: "new7", label: "近 7 天新增" },
  { key: "paying", label: "付费用户" },
  { key: "holders", label: "持有冻干" },
] as const;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function userState(user: Record<string, unknown>) {
  if (user.deleted_at) return <Badge tone="neutral">已注销</Badge>;
  if (user.admin_suspended_at) return <Badge tone="critical">已停用</Badge>;
  return <Badge tone="good">正常</Badge>;
}

export default async function UsersPage({ searchParams }: Props) {
  await requireAdminPage("/admin/users");
  const params = await searchParams;
  const q = one(params.q)?.slice(0, 120);
  const status = (["all", "active", "suspended", "deleted"].includes(one(params.status) || "") ? one(params.status) : "all") as UserFilter["status"];
  const segment = (SEGMENTS.some((item) => item.key === one(params.segment)) ? one(params.segment) : "all") as UserFilter["segment"];
  const page = Number(one(params.page) || 1);
  const result = await listUsers({ q, status, segment, page });
  const href = (next: Record<string, string | number | undefined>) => withQuery("/admin/users", { q, status: status === "all" ? undefined : status, segment: segment === "all" ? undefined : segment, ...next });

  return (
    <>
      <PageHeader title="用户" description="查看用户资产、付费与活跃情况；停用、补偿等操作在用户详情页完成并写入审计。" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentLinks label="用户分群" active={segment || "all"} items={SEGMENTS.map((item) => ({ key: item.key, label: item.label, href: href({ segment: item.key === "all" ? undefined : item.key, page: undefined }) }))} />
        <FilterBar
          action="/admin/users"
          q={q}
          placeholder="用户 ID、昵称、账号名、unionid、openid"
          hidden={{ segment: segment === "all" ? undefined : segment }}
          selects={[{ name: "status", label: "账号状态", value: status === "all" ? "" : status, options: [{ value: "", label: "全部状态" }, { value: "active", label: "正常" }, { value: "suspended", label: "已停用" }, { value: "deleted", label: "已注销" }] }]}
        />
      </div>
      <Card>
        {result.items.length ? (
          <>
            <Table>
              <thead>
                <tr><Th>用户</Th><Th>状态</Th><Th align="right">宠物 / 作品</Th><Th align="right">冻干余额</Th><Th align="right">累计实收</Th><Th>最近活跃</Th><Th>注册时间</Th></tr>
              </thead>
              <tbody>
                {result.items.map((user) => (
                  <Tr key={String(user.id)}>
                    <Td>
                      <Link href={`/admin/users/${user.id}`} className="group block">
                        <span className="font-medium text-ink group-hover:underline">{String(user.display_name || user.account_name || "未命名用户")}</span>
                        <span className="mt-0.5 flex items-center gap-2"><Mono>{String(user.id).slice(0, 8)}</Mono>{user.wechat ? <span className="text-[11px] text-muted">微信</span> : null}</span>
                      </Link>
                    </Td>
                    <Td>{userState(user)}</Td>
                    <Td align="right">{formatCount(user.pets as number)} / {formatCount(user.works as number)}</Td>
                    <Td align="right">{formatCount(user.balance as number)} 颗</Td>
                    <Td align="right">{Number(user.revenue) ? <span className="font-medium">{formatYuan(user.revenue as number)}</span> : <span className="text-muted">—</span>}<span className="block text-[11px] text-muted">{formatCount(user.orders as number)} 笔</span></Td>
                    <Td className="text-ink-2">{formatRelative(user.last_active as string)}</Td>
                    <Td className="text-ink-2">{formatDate(user.created_at as string)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(next) => href({ page: next })} />
          </>
        ) : <EmptyState icon={Users} title="没有符合条件的用户" description="换个关键词或分群再试试" />}
      </Card>
    </>
  );
}
