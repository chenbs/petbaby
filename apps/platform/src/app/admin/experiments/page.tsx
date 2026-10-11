import Link from "next/link";
import { FlaskConical } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { Badge, Card, CardBody, CardHeader, cn, EmptyState, Mono, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/admin/ui";
import { formatCount, formatDateTime, formatPercent, formatYuan } from "@/lib/admin-format";
import { plugins } from "@/plugins/registry";
import { pluginName } from "@/server/admin/analytics";
import { requireAdminPage } from "@/server/admin/page-guard";
import { getExperimentDetail, listExperiments } from "@/server/growth-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "玩法赛马" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 与 growth-service.updateExperiment 的状态机一致：idea → testing → live → archived，archived 可回到 testing。 */
const NEXT_STATES: Record<string, Array<{ to: string; label: string }>> = {
  idea: [{ to: "testing", label: "开始测试" }, { to: "archived", label: "归档" }],
  testing: [{ to: "live", label: "上线" }, { to: "archived", label: "归档" }],
  live: [{ to: "archived", label: "下线归档" }],
  archived: [{ to: "testing", label: "重新测试" }],
};

const METRIC_LABELS: Record<string, string> = { exposure: "曝光", start: "开始", completion: "完成", paid: "支付", refund: "退款", cost: "成本" };
const UUID = /^[0-9a-f-]{36}$/i;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExperimentsPage({ searchParams }: Props) {
  await requireAdminPage("/admin/experiments");
  const params = await searchParams;
  const selectedId = one(params.id);
  const items = (await listExperiments({})) as Array<Record<string, unknown> & { delta?: Record<string, number> | null }>;
  const detail = selectedId && UUID.test(selectedId) ? await getExperimentDetail(selectedId).catch(() => null) : null;
  const livePlugins = plugins.filter((plugin) => plugin.status === "live");

  return (
    <>
      <PageHeader
        title="玩法赛马"
        description="同一玩法的多个变体并行测试，按完成率、支付率与毛利对比当前 live 版本；上线后会替换线上配置，可一键回滚到上一个 live。"
        actions={<ActionDialog
          label="新建变体"
          title="把一个变体加入赛马"
          description="新变体从「构想」开始，不影响线上；变体配置里的 manifestPatch 会在上线时覆盖原 manifest。"
          endpoint="/api/admin/experiments"
          body={{ status: "idea" }}
          fields={[
            { name: "pluginId", label: "玩法", type: "select", required: true, options: livePlugins.map((plugin) => ({ value: plugin.id, label: `${plugin.code} · ${plugin.name}` })) },
            { name: "variantCode", label: "变体编码", required: true, defaultValue: "v2", maxLength: 80 },
            { name: "channel", label: "渠道", type: "select", options: [{ value: "all", label: "全渠道" }, { value: "miniprogram", label: "小程序" }, { value: "web", label: "Web" }] },
            { name: "config", label: "变体配置 JSON", type: "json", defaultValue: "{\n  \"manifestPatch\": {}\n}" },
          ]}
          reasonDefault="创建赛马变体"
          variant="primary"
          size="md"
          success="变体已创建"
        />}
      />

      <Card>
        {items.length ? (
          <Table>
            <thead><tr><Th>玩法 / 变体</Th><Th>状态</Th><Th align="right">曝光</Th><Th align="right">完成率</Th><Th align="right">支付率</Th><Th align="right">收入 / 成本</Th><Th align="right">毛利</Th><Th align="right">较 live</Th><Th align="right">流转</Th></tr></thead>
            <tbody>
              {items.map((item) => {
                const isBaseline = item.live_baseline_id === item.id;
                const delta = item.delta && !isBaseline ? item.delta : null;
                return (
                  <Tr key={String(item.id)} className={cn(selectedId === item.id && "bg-surface-2")}>
                    <Td><Link href={`/admin/experiments?id=${item.id}`} className="font-medium hover:underline">{pluginName(item.plugin_id)}</Link><Mono className="ml-2">{String(item.variant_code || "default")}</Mono></Td>
                    <Td><StatusBadge status={item.status} />{isBaseline ? <span className="ml-2 text-[11px] text-muted">基准</span> : null}</Td>
                    <Td align="right">{formatCount(Number(item.exposure))}</Td>
                    <Td align="right">{formatPercent(Number(item.completion_rate))}</Td>
                    <Td align="right">{formatPercent(Number(item.paid_rate))}</Td>
                    <Td align="right">{formatYuan(Number(item.revenue))}<span className="block text-[11px] text-muted">{formatYuan(Number(item.cost))}</span></Td>
                    <Td align="right" className="font-medium">{formatYuan(Number(item.gross_profit))}</Td>
                    <Td align="right" className="text-xs">{delta ? <><span className={delta.paid_rate >= 0 ? "text-good-ink" : "text-critical-ink"}>{delta.paid_rate >= 0 ? "+" : ""}{(delta.paid_rate * 100).toFixed(1)} pt 支付</span><span className="block text-muted">{delta.gross_profit >= 0 ? "+" : ""}{formatYuan(delta.gross_profit)} 毛利</span></> : <span className="text-muted">—</span>}</Td>
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {(NEXT_STATES[String(item.status)] || []).map((next) => (
                          <ActionDialog key={next.to} label={next.label} title={`${next.label} · ${pluginName(item.plugin_id)} / ${String(item.variant_code)}`} description={next.to === "live" ? "上线后该玩法的线上配置立即切到这个变体。" : undefined} endpoint={`/api/admin/experiments/${item.id}`} method="PATCH" body={{ status: next.to, config: item.config || {} }} danger={next.to === "archived" && item.status === "live"} reasonDefault="运营评审通过" success="已流转" />
                        ))}
                        {item.status === "live" && item.superseded_live_id ? <ActionDialog label="回滚" title="回滚到上一个 live 变体" endpoint={`/api/admin/experiments/${item.id}`} body={{ action: "rollback" }} danger reasonDefault="效果不及预期，回滚" success="已回滚" /> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        ) : <EmptyState icon={FlaskConical} title="还没有赛马变体" description="点右上角「新建变体」开始第一组测试" />}
      </Card>

      {detail ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader
              title={`指标明细 · ${pluginName(detail.variant.plugin_id)} / ${String(detail.variant.variant_code)}`}
              actions={<ActionDialog
                label="补录指标"
                title="人工补录赛马指标"
                description="自动埋点覆盖不到的渠道（例如线下活动）用这里补；统计周期默认为今天。"
                endpoint="/api/admin/experiments/metrics"
                body={{ variantId: detail.variant.id, source: "manual", channel: "all", periodStart: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), periodEnd: new Date().toISOString() }}
                fields={[
                  { name: "metric", label: "指标", type: "select", options: Object.entries(METRIC_LABELS).map(([value, label]) => ({ value, label })) },
                  { name: "value", label: "数值", type: "number", required: true, min: 0, defaultValue: "0" },
                  { name: "revenue", label: "收入（元）", type: "number", min: 0, defaultValue: "0" },
                ]}
                reasonField={false}
                success="指标已记录"
              />}
            />
            <CardBody className="px-0 pb-0 pt-3">
              {detail.metrics.length ? (
                <Table>
                  <thead><tr><Th>周期</Th><Th>指标</Th><Th align="right">数值</Th><Th align="right">收入</Th><Th>来源</Th></tr></thead>
                  <tbody>{detail.metrics.map((metric: Record<string, unknown>) => (
                    <Tr key={String(metric.id)}><Td className="text-ink-2">{formatDateTime(metric.period_start as string)}</Td><Td>{METRIC_LABELS[String(metric.metric)] || String(metric.metric)}</Td><Td align="right">{formatCount(Number(metric.value))}</Td><Td align="right">{formatYuan(Number(metric.revenue || 0))}</Td><Td><Badge tone={metric.source === "manual" ? "warning" : "neutral"} dot={false}>{metric.source === "manual" ? "人工" : "自动"}</Badge></Td></Tr>
                  ))}</tbody>
                </Table>
              ) : <p className="px-5 pb-6 text-xs text-muted">还没有指标</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="流转记录" />
            <CardBody className="pt-2">
              {detail.operations.length ? (
                <ul className="divide-y divide-line text-sm">
                  {detail.operations.map((operation: Record<string, unknown>) => (
                    <li key={String(operation.id)} className="flex items-start justify-between gap-3 py-2.5">
                      <span><span className="text-ink">{operation.from_status ? <StatusBadge status={operation.from_status} /> : "新建"} → <StatusBadge status={operation.to_status} /></span><span className="mt-1 block text-xs text-muted">{String(operation.reason)}</span></span>
                      <span className="shrink-0 text-xs text-muted">{formatDateTime(operation.created_at as string)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="py-6 text-xs text-muted">没有流转记录</p>}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}
