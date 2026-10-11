import Link from "next/link";
import { Package, ReceiptText } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { FilterBar } from "@/components/admin/filter-bar";
import { Card, EmptyState, Mono, PageHeader, Pagination, SegmentLinks, StatusBadge, Table, Td, Th, Tr, withQuery } from "@/components/admin/ui";
import { GROWTH_KIND_LABELS, ORDER_KIND_LABELS, PROVIDER_LABELS, statusLabel } from "@/lib/admin-labels";
import { formatCount, formatDateTime, formatYuan } from "@/lib/admin-format";
import { listPayments, listPhysicalOrders, paymentSummary } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "订单与履约" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** 实体单允许的下一步（与 growth-service.updatePhysicalOrderStatus 的状态机一致） */
const PHYSICAL_NEXT: Record<string, string[]> = {
  pending: ["cancelled"],
  paid: ["producing", "cancelled", "after_sale"],
  producing: ["shipped", "cancelled", "after_sale"],
  shipped: ["completed", "after_sale"],
  after_sale: ["completed", "refunded"],
  completed: ["after_sale"],
};

const PHYSICAL_ACTIONS: Record<string, string> = { producing: "开始制作", shipped: "确认发货", completed: "完成", cancelled: "取消", after_sale: "进入售后", refunded: "退款完成" };

export default async function OrdersPage({ searchParams }: Props) {
  await requireAdminPage("/admin/orders");
  const params = await searchParams;
  const tab = one(params.tab) === "physical" ? "physical" : "payments";
  const q = one(params.q)?.slice(0, 120);
  const kind = one(params.kind);
  const status = one(params.status);
  const page = Number(one(params.page) || 1);
  const [summary, payments, physical] = await Promise.all([
    paymentSummary(),
    tab === "payments" ? listPayments({ q, kind, status, page }) : null,
    tab === "physical" ? listPhysicalOrders(status) : null,
  ]);
  const href = (next: Record<string, string | number | undefined>) => withQuery("/admin/orders", { tab: tab === "payments" ? undefined : tab, q, kind, status, ...next });

  return (
    <>
      <PageHeader title="订单与履约" description="以支付流水为准查看每一笔收款；退款走支付渠道，到账后自动回收冻干或权益。" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "已支付", value: summary.paid },
          { label: "待支付", value: summary.pending, hint: Number(summary.stale_pending) ? `${summary.stale_pending} 笔超过 30 分钟` : undefined },
          { label: "退款处理中", value: summary.refunding },
          { label: "已退款", value: summary.refunded },
          { label: "已关闭", value: summary.closed },
        ].map((item) => (
          <Card key={item.label} className="px-4 py-3">
            <p className="text-xs text-muted">{item.label}</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatCount(Number(item.value || 0))}</p>
            {item.hint ? <p className="mt-0.5 text-[11px] text-critical-ink">{item.hint}</p> : null}
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentLinks label="订单类型" active={tab} items={[{ key: "payments", label: "支付流水", href: "/admin/orders" }, { key: "physical", label: "实体履约", href: "/admin/orders?tab=physical" }]} />
        {tab === "payments" ? (
          <FilterBar
            action="/admin/orders"
            q={q}
            placeholder="商户单号、订单 ID、用户 ID、SKU"
            selects={[
              { name: "kind", label: "类型", value: kind, options: [{ value: "", label: "全部类型" }, { value: "wallet_topup", label: "冻干充值" }, { value: "art_photo_bundle", label: "写真套餐" }, { value: "health_archive", label: "健康档案" }, { value: "physical", label: "实体订单" }, { value: "work", label: "历史作品单" }] },
              { name: "status", label: "状态", value: status, options: [{ value: "", label: "全部状态" }, { value: "paid", label: "已支付" }, { value: "pending", label: "待支付" }, { value: "refunded", label: "已退款" }, { value: "closed", label: "已关闭" }] },
            ]}
          />
        ) : (
          <FilterBar
            action="/admin/orders"
            hidden={{ tab: "physical" }}
            placeholder="（实体单按状态筛选）"
            selects={[{ name: "status", label: "状态", value: status, options: [{ value: "", label: "全部状态" }, ...["pending", "paid", "producing", "shipped", "after_sale", "completed", "cancelled", "refunded"].map((value) => ({ value, label: statusLabel(value).label }))] }]}
          />
        )}
      </div>

      {payments ? (
        <Card>
          {payments.items.length ? (
            <>
              <Table>
                <thead><tr><Th>商品</Th><Th>用户</Th><Th>渠道</Th><Th align="right">金额</Th><Th>状态</Th><Th>创建时间</Th><Th align="right">操作</Th></tr></thead>
                <tbody>
                  {payments.items.map((item) => {
                    const refundable = item.status === "paid" && !item.refund_status && (item.order_kind === "work" || (item.order_kind === "growth" && item.growth_status === "paid"));
                    return (
                      <Tr key={String(item.id)}>
                        <Td>
                          <span className="font-medium text-ink">{GROWTH_KIND_LABELS[String(item.growth_kind)] || ORDER_KIND_LABELS[String(item.order_kind)]}</span>
                          <span className="mt-0.5 block"><Mono>{String(item.out_trade_no)}</Mono></span>
                        </Td>
                        <Td><Link href={`/admin/users/${item.user_id}`} className="hover:underline">{String(item.display_name || "未命名用户")}</Link><Mono className="ml-2">{String(item.user_id).slice(0, 8)}</Mono></Td>
                        <Td className="text-ink-2">{PROVIDER_LABELS[String(item.provider)] || String(item.provider)}</Td>
                        <Td align="right">
                          <span className="font-medium">{formatYuan(Number(item.amount_fen) / 100)}</span>
                          {Number(item.refunded_fen) ? <span className="block text-[11px] text-critical-ink">已退 {formatYuan(Number(item.refunded_fen) / 100)}</span> : null}
                        </Td>
                        <Td><StatusBadge status={item.status} />{item.refund_status && item.refund_status !== "succeeded" ? <span className="mt-1 block text-[11px] text-muted">退款 {statusLabel(item.refund_status).label}</span> : null}</Td>
                        <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                        <Td align="right">
                          {refundable ? (
                            <ActionDialog
                              label="退款"
                              title="原路退款"
                              description={item.growth_kind === "wallet_topup" ? "退款到账后会回收这笔充值对应的冻干；已经花掉的部分会导致退款失败，需要先与用户确认。" : "退款走支付渠道，到账后自动回收对应权益。"}
                              endpoint={item.order_kind === "work" ? "/api/admin/operations" : "/api/admin/business"}
                              body={item.order_kind === "work" ? { action: "refund_order", orderId: item.order_id, refundReason: "requested" } : { action: "refund_growth_order", id: item.order_id }}
                              danger
                              confirmLabel={`退款 ${formatYuan(Number(item.amount_fen) / 100)}`}
                              success="退款已提交"
                            />
                          ) : <span className="text-xs text-muted">—</span>}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination page={payments.page} pageSize={payments.pageSize} total={payments.total} hrefFor={(next) => href({ page: next })} />
            </>
          ) : <EmptyState icon={ReceiptText} title="没有符合条件的支付流水" />}
        </Card>
      ) : null}

      {physical ? (
        <Card>
          {physical.length ? (
            <Table>
              <thead><tr><Th>商品</Th><Th>收货（脱敏）</Th><Th align="right">金额</Th><Th>状态</Th><Th>物流 / 记录</Th><Th align="right">操作</Th></tr></thead>
              <tbody>
                {physical.map((item) => {
                  const address = item.address as { name?: string; phone?: string; region?: string; detail?: string; invalid?: boolean } | null;
                  const events = (item.events || []) as Array<{ from_status?: string; to_status: string; note?: string; created_at: string }>;
                  const next = PHYSICAL_NEXT[String(item.status)] || [];
                  return (
                    <Tr key={String(item.id)}>
                      <Td><span className="font-medium">{String(item.sku)}</span><span className="mt-0.5 block text-xs text-muted">{String(item.display_name || "未命名用户")} · {formatDateTime(item.created_at as string)}</span></Td>
                      <Td className="text-ink-2">{address?.invalid ? <span className="text-critical-ink">地址无法解密</span> : address ? <>{address.name} {address.phone}<span className="block text-xs text-muted">{address.region} {address.detail}</span></> : "—"}</Td>
                      <Td align="right">{formatYuan(Number(item.amount || 0))}</Td>
                      <Td><StatusBadge status={item.status} /></Td>
                      <Td className="max-w-64 text-xs text-ink-2">
                        {item.tracking_no ? <span className="block">{String(item.carrier)} <Mono>{String(item.tracking_no)}</Mono></span> : null}
                        <span className="block truncate text-muted">{events.slice(0, 3).map((event) => `${statusLabel(event.from_status || "new").label}→${statusLabel(event.to_status).label}`).join(" · ") || "—"}</span>
                        {item.print_pdf_key ? <a href={`/api/admin/physical-orders/${item.id}/print`} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-2">印刷 PDF</a> : null}
                      </Td>
                      <Td align="right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {next.map((target) => (
                            <ActionDialog
                              key={target}
                              label={PHYSICAL_ACTIONS[target]}
                              title={`${PHYSICAL_ACTIONS[target]} · ${String(item.sku)}`}
                              endpoint={`/api/admin/physical-orders/${item.id}/status`}
                              body={{ status: target }}
                              fields={target === "shipped" ? [{ name: "carrier", label: "承运商", required: true, maxLength: 80 }, { name: "trackingNo", label: "运单号", required: true, maxLength: 120 }] : []}
                              reasonField="note"
                              reasonDefault="后台履约操作"
                              danger={target === "cancelled" || target === "refunded"}
                              success="履约状态已更新"
                            />
                          ))}
                          {!next.length ? <span className="text-xs text-muted">—</span> : null}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <EmptyState icon={Package} title="没有实体订单" description="实体商品下单后会出现在这里" />}
        </Card>
      ) : null}
    </>
  );
}
