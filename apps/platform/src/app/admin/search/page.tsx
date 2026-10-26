import Link from "next/link";
import { Search } from "lucide-react";

import { Card, CardHeader, EmptyState, Mono, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/admin/ui";
import { formatDate, formatDateTime, formatYuan } from "@/lib/admin-format";
import { globalSearch } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "搜索" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SearchPage({ searchParams }: Props) {
  await requireAdminPage("/admin/search");
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw || "").slice(0, 120);
  const result = await globalSearch(q);
  const empty = !result.users.length && !result.payments.length;

  return (
    <>
      <PageHeader title={q ? `「${q}」的搜索结果` : "搜索"} description="按用户 ID、昵称、账号名、用户短 ID、openid 或商户单号查找。" />
      {q.trim().length < 2 ? <Card><EmptyState icon={Search} title="至少输入 2 个字符" /></Card> : empty ? <Card><EmptyState icon={Search} title="没有找到匹配的用户或订单" /></Card> : (
        <div className="space-y-4">
          {result.users.length ? (
            <Card>
              <CardHeader title="用户" className="pb-3" />
              <Table>
                <thead><tr><Th>用户</Th><Th>账号名</Th><Th>注册</Th></tr></thead>
                <tbody>{result.users.map((user) => (
                  <Tr key={String(user.id)}>
                    <Td><Link href={`/admin/users/${user.id}`} className="font-medium hover:underline">{String(user.display_name || "未命名用户")}</Link><Mono className="ml-2">{String(user.id).slice(0, 8)}</Mono></Td>
                    <Td className="text-ink-2">{String(user.account_name || "—")}</Td>
                    <Td className="text-ink-2">{formatDate(user.created_at as string)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            </Card>
          ) : null}
          {result.payments.length ? (
            <Card>
              <CardHeader title="支付流水" className="pb-3" />
              <Table>
                <thead><tr><Th>商户单号</Th><Th>SKU</Th><Th align="right">金额</Th><Th>状态</Th><Th>时间</Th></tr></thead>
                <tbody>{result.payments.map((item) => (
                  <Tr key={String(item.id)}>
                    <Td><Link href={`/admin/orders?q=${encodeURIComponent(String(item.out_trade_no))}`} className="hover:underline"><Mono>{String(item.out_trade_no)}</Mono></Link></Td>
                    <Td><Mono>{String(item.sku)}</Mono></Td>
                    <Td align="right">{formatYuan(Number(item.amount_fen) / 100)}</Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
