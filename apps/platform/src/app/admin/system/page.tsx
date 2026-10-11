import { CircleAlert, CircleCheck, Server } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { Badge, Card, CardBody, CardHeader, Mono, PageHeader, Table, Td, Th, Tr } from "@/components/admin/ui";
import { formatCount, formatDateTime, formatPercent, formatYuan } from "@/lib/admin-format";
import { attentionQueue } from "@/server/admin/analytics";
import { taskHealth } from "@/server/admin/console";
import { requireAdminPage } from "@/server/admin/page-guard";
import { inspectConfiguration } from "@/server/config";
import { healthSnapshot } from "@/server/maintenance";

export const dynamic = "force-dynamic";
export const metadata = { title: "系统健康" };

const MODE_LABELS = { production: "正式生产", staging: "测试机（staging）", development: "本地开发" } as const;

export default async function SystemPage() {
  await requireAdminPage("/admin/system");
  const [health, tasks, attention] = await Promise.all([healthSnapshot(), taskHealth(), attentionQueue()]);
  const configuration = inspectConfiguration();
  const today = tasks.usage[0];
  const usageRatio = today ? Number(today.generation_count) / tasks.dailyLimit : 0;
  const costRatio = today ? Number(today.estimated_cost) / tasks.costLimit : 0;
  const missing = configuration.checks.filter((check) => check.required && !check.configured);

  return (
    <>
      <PageHeader title="系统健康" description="数据库与队列、生成熔断、模型通道、每日额度与环境配置。熔断操作会立即影响线上生成，务必写清原因。" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-medium text-muted">服务状态</p>
          <p className="mt-3 flex items-center gap-2 text-xl font-semibold text-ink">{health.status === "ok" ? <CircleCheck aria-hidden className="size-5 text-good-ink" /> : <CircleAlert aria-hidden className="size-5 text-critical-ink" />}{health.status === "ok" ? "正常" : "降级"}</p>
          <p className="mt-2 text-xs text-muted">数据库{health.database ? "可用" : "不可用"} · 排队 {formatCount(health.queued)} · 卡住 {formatCount(health.stale)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted">今日生成次数</p>
          <p className="mt-3 text-xl font-semibold text-ink">{formatCount(Number(today?.generation_count || 0))}<span className="ml-1 text-sm font-normal text-muted">/ {formatCount(tasks.dailyLimit)}</span></p>
          <Meter ratio={usageRatio} label="今日生成额度占用" />
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted">今日估算成本</p>
          <p className="mt-3 text-xl font-semibold text-ink">{formatYuan(Number(today?.estimated_cost || 0))}<span className="ml-1 text-sm font-normal text-muted">/ {formatYuan(tasks.costLimit)}</span></p>
          <Meter ratio={costRatio} label="今日成本额度占用" />
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted">运行模式</p>
          <p className="mt-3 text-xl font-semibold text-ink">{MODE_LABELS[configuration.mode]}</p>
          <p className="mt-2 text-xs text-muted">{configuration.productionReady ? "配置齐全，可上线" : `${missing.length} 项必填配置缺失`}</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="生成熔断"
            description="开启后所有新的生成请求直接拒绝（503），在途任务不受影响。超过每日次数或成本上限时会自动开启。"
            actions={attention.generationCircuit
              ? <ActionDialog label="关闭熔断" title="关闭今日生成熔断" description="确认成本与故障已经处理完毕。若今日用量仍超过上限，下一次请求会再次自动熔断。" endpoint="/api/admin/operations" body={{ action: "set_circuit", open: false }} variant="primary" success="生成熔断已关闭" />
              : <ActionDialog label="开启熔断" title="开启今日生成熔断" description="所有用户将无法发起新的生成，直到手动关闭或次日。" endpoint="/api/admin/operations" body={{ action: "set_circuit", open: true }} danger success="生成熔断已开启" />}
          />
          <CardBody>
            <p className="flex items-center gap-2 text-sm">{attention.generationCircuit ? <><CircleAlert aria-hidden className="size-4 text-critical-ink" /><span className="text-critical-ink">今日已熔断</span></> : <><CircleCheck aria-hidden className="size-4 text-good-ink" /><span className="text-ink">未熔断</span></>}</p>
            <div className="mt-4">
              <Table>
                <thead><tr><Th>日期（UTC）</Th><Th align="right">生成次数</Th><Th align="right">估算成本</Th><Th>熔断</Th></tr></thead>
                <tbody>{tasks.usage.map((row) => (
                  <Tr key={String(row.usage_date)}><Td>{String(row.usage_date)}</Td><Td align="right">{formatCount(Number(row.generation_count))}</Td><Td align="right">{formatYuan(Number(row.estimated_cost))}</Td><Td>{row.circuit_open ? <Badge tone="critical">已熔断</Badge> : <Badge tone="good">正常</Badge>}</Td></Tr>
                ))}</tbody>
              </Table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="图片模型通道" description="连续失败会自动熔断并切到备用通道；人工熔断需人工恢复。" />
          <CardBody className="px-0 pb-0">
            {tasks.circuits.length ? (
              <Table>
                <thead><tr><Th>通道</Th><Th align="right">连续失败</Th><Th>状态</Th><Th>更新</Th><Th align="right">操作</Th></tr></thead>
                <tbody>{tasks.circuits.map((row) => {
                  const open = Boolean(row.manual_open || row.opened_at);
                  return (
                    <Tr key={String(row.provider)}>
                      <Td className="font-medium">{String(row.provider)}</Td>
                      <Td align="right">{formatCount(Number(row.failures))}</Td>
                      <Td>{row.manual_open ? <Badge tone="critical">人工熔断</Badge> : row.opened_at ? <Badge tone="warning">自动熔断</Badge> : <Badge tone="good">可用</Badge>}</Td>
                      <Td className="text-ink-2">{formatDateTime(row.updated_at as string)}</Td>
                      <Td align="right">{open
                        ? <ActionDialog label="恢复" title={`恢复通道 ${String(row.provider)}`} endpoint="/api/admin/operations" body={{ action: "set_ai_circuit", provider: row.provider, open: false }} success="通道已恢复" />
                        : <ActionDialog label="熔断" title={`熔断通道 ${String(row.provider)}`} description="该通道不再接收请求，流量切到其他通道。" endpoint="/api/admin/operations" body={{ action: "set_ai_circuit", provider: row.provider, open: true }} danger success="通道已熔断" />}</Td>
                    </Tr>
                  );
                })}</tbody>
              </Table>
            ) : <p className="px-5 pb-6 text-xs text-muted">还没有通道记录（首次调用模型后出现）</p>}
            <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
              <ActionDialog label="熔断指定通道" title="熔断指定通道" endpoint="/api/admin/operations" body={{ action: "set_ai_circuit", open: true }} fields={[{ name: "provider", label: "通道名", required: true, defaultValue: "primary", hint: "primary / secondary" }]} danger success="通道已熔断" />
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="模型调用成本（近 7 天）" actions={<Server aria-hidden className="size-4 text-muted" />} />
        <CardBody className="px-0 pb-0">
          {tasks.cost.length ? (
            <Table>
              <thead><tr><Th>通道</Th><Th>模型</Th><Th align="right">调用</Th><Th align="right">失败率</Th><Th align="right">成本</Th></tr></thead>
              <tbody>{tasks.cost.map((row) => (
                <Tr key={`${row.provider}-${row.model_version}`}>
                  <Td>{String(row.provider)}</Td><Td><Mono>{String(row.model_version)}</Mono></Td>
                  <Td align="right">{formatCount(Number(row.calls))}</Td>
                  <Td align="right">{formatPercent(Number(row.calls) ? Number(row.failures) / Number(row.calls) : 0)}</Td>
                  <Td align="right">{formatYuan(Number(row.amount))}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          ) : <p className="px-5 pb-6 text-xs text-muted">近 7 天没有模型调用</p>}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="环境配置诊断" description={`${configuration.checks.filter((check) => check.configured).length} / ${configuration.checks.length} 项已配置 · 只显示是否配置，不显示值`} />
        <CardBody className="px-0 pb-0">
          <Table>
            <thead><tr><Th>变量</Th><Th>说明</Th><Th>状态</Th></tr></thead>
            <tbody>{configuration.checks.map((check) => (
              <Tr key={check.key}>
                <Td><Mono>{check.key}</Mono></Td>
                <Td className="text-ink-2">{check.hint}</Td>
                <Td>{check.configured ? <Badge tone="good">已配置</Badge> : check.required ? <Badge tone="critical">必填缺失</Badge> : <Badge tone="neutral">可选</Badge>}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}

/** 额度条：填充随占用升级（蓝 → 警示 → 危险），底轨是同色系浅阶；数值写在条上方，不靠颜色。 */
function Meter({ ratio, label }: { ratio: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const fill = clamped >= 0.9 ? "var(--critical)" : clamped >= 0.7 ? "var(--warning)" : "var(--series-1)";
  return (
    <div className="mt-3">
      <div className="h-1.5 rounded-full bg-[color-mix(in_srgb,var(--series-1)_14%,transparent)]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(clamped ? 2 : 0, clamped * 100)}%`, background: fill }} />
      </div>
      <p className="mt-1.5 text-xs text-muted">已用 {formatPercent(clamped, 0)}{clamped >= 0.9 ? " · 接近上限" : ""}</p>
    </div>
  );
}
