import Link from "next/link";
import { CircleAlert, CircleCheck, Coins, ShoppingBag, Sparkles, UserPlus, Users } from "lucide-react";

import { ChartFrame, StackedBars, TrendChart } from "@/components/admin/charts";
import { RangePicker } from "@/components/admin/range-picker";
import { BarList, StatCard } from "@/components/admin/stat";
import { Card, CardBody, CardHeader, Mono, PageHeader } from "@/components/admin/ui";
import { auditActionLabel } from "@/lib/admin-labels";
import { formatCompact, formatCount, formatPercent, formatRelative, formatYuan } from "@/lib/admin-format";
import { describeRange, rangeQuery, resolveAdminRange } from "@/lib/admin-range";
import { getOverview } from "@/server/admin/analytics";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "总览" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminOverviewPage({ searchParams }: Props) {
  await requireAdminPage("/admin");
  const range = resolveAdminRange(await searchParams);
  const data = await getOverview(range);
  const { now, before, daily, attention } = data;
  const query = rangeQuery(range);

  const todo = [
    { key: "ai", label: "失败的图片任务（7 天）", value: attention.failedAi, href: "/admin/tasks?kind=image&status=failed" },
    { key: "layout", label: "失败的排版任务（7 天）", value: attention.failedTasks, href: "/admin/tasks?kind=layout&status=failed" },
    { key: "video", label: "失败的短片渲染（7 天）", value: attention.failedVideos, href: "/admin/tasks?kind=video&status=failed" },
    { key: "stale", label: "卡住超过 5 分钟的任务", value: attention.staleTasks, href: "/admin/system" },
    { key: "backlog", label: "排队超过 10 分钟", value: attention.backlog, href: "/admin/system" },
    { key: "physical", label: "待履约实体单", value: attention.physicalPending, href: "/admin/orders?tab=physical" },
    { key: "refunds", label: "处理中的退款", value: attention.pendingRefunds, href: "/admin/orders" },
    { key: "messages", label: "发送失败的订阅消息", value: attention.failedMessages, href: "/admin/messages" },
  ];
  const openTodo = todo.filter((item) => item.value > 0);
  const circuitAlert = attention.generationCircuit || attention.openCircuits > 0;

  return (
    <>
      <PageHeader
        eyebrow={`${range.from} 至 ${range.to} · 北京时间`}
        title="运营总览"
        description="核心增长、创作与收入指标，环比对比等长的上一周期。"
        actions={<RangePicker preset={range.preset} from={range.from} to={range.to} label={describeRange(range)} />}
      />

      {circuitAlert ? (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--critical)_8%,transparent)] px-4 py-3 text-sm text-critical-ink">
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          <span className="flex-1">{attention.generationCircuit ? "今日生成熔断已开启，所有新的生成请求都会被拒绝。" : `有 ${attention.openCircuits} 个图片模型通道处于熔断状态。`}</span>
          <Link href="/admin/system" className="font-medium underline underline-offset-4">去处理</Link>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard emphasis label="现金收入" icon={Coins} value={formatYuan(now.revenue, { compact: true })} current={now.revenue} previous={before.revenue} trend={daily.map((row) => row.revenue)} hint={`付费 ${formatCount(now.payingUsers)} 人 · 退款 ${formatYuan(now.refunds)}`} />
        <StatCard emphasis label="活跃用户" icon={Users} value={formatCompact(now.activeUsers)} current={now.activeUsers} previous={before.activeUsers} trend={daily.map((row) => row.activeUsers)} hint="区间内有任意创作、上传、记录或埋点行为" />
        <StatCard emphasis label="新增用户" icon={UserPlus} value={formatCompact(now.newUsers)} current={now.newUsers} previous={before.newUsers} trend={daily.map((row) => row.newUsers)} hint={`累计 ${formatCount(data.totals.users)} 人 · ${formatCount(data.totals.pets)} 只宠物`} />
        <StatCard emphasis label="创作次数" icon={Sparkles} value={formatCompact(now.creations)} current={now.creations} previous={before.creations} hint={`成功率 ${formatPercent(now.successRate)} · 消耗冻干 ${formatCount(now.spentUnits)} 颗`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartFrame
          className="xl:col-span-2"
          title="活跃用户构成"
          description="每日活跃 = 当日新注册 + 回访老用户"
          series={[{ key: "returningUsers", label: "回访用户" }, { key: "newUsers", label: "新注册" }]}
          rows={daily}
        >
          <StackedBars rows={daily} series={[{ key: "returningUsers", label: "回访用户" }, { key: "newUsers", label: "新注册" }]} />
        </ChartFrame>

        <Card>
          <CardHeader title="待处理" description={openTodo.length ? `${openTodo.length} 类事项需要处理` : "当前没有积压"} />
          <CardBody className="pt-3">
            {openTodo.length ? (
              <ul className="divide-y divide-line">
                {openTodo.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-surface-2">
                      <span className="inline-flex items-center gap-2 text-ink"><CircleAlert aria-hidden className="size-4 text-critical-ink" />{item.label}</span>
                      <b className="font-semibold text-ink tnum">{formatCount(item.value)}</b>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-6 text-sm text-ink-2"><CircleCheck aria-hidden className="size-5 text-good-ink" />任务、订单、消息都没有积压。</div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartFrame className="xl:col-span-2" title="每日现金收入" description="充值、增值单、实体单与历史作品单的实收合计" series={[{ key: "revenue", label: "现金收入" }]} rows={daily} valueKind="yuan">
          <TrendChart area rows={daily} series={[{ key: "revenue", label: "现金收入" }]} valueKind="yuan" />
        </ChartFrame>

        <Card>
          <CardHeader title="功能使用" description={describeRange(range)} actions={<Link href={`/admin/features?${query}`} className="text-xs text-ink-2 hover:text-ink">详情</Link>} />
          <CardBody className="pt-3">
            <BarList
              items={[...data.features].filter((item) => item.uses > 0).sort((left, right) => right.uses - left.uses).map((item) => ({ key: item.key, label: item.label, value: item.uses, sub: `${formatCount(item.users)} 人` }))}
              format={formatCount}
              emptyText="区间内还没有功能使用"
            />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="累计资产" description="当前存量（不受区间影响）" />
          <CardBody className="grid grid-cols-2 gap-4 pt-3 sm:grid-cols-4">
            {[
              { label: "用户", value: data.totals.users },
              { label: "宠物", value: data.totals.pets },
              { label: "照片", value: data.totals.photos },
              { label: "作品", value: data.totals.works },
            ].map((item) => (
              <div key={item.label} className="rounded-lg bg-surface-2 px-4 py-3">
                <p className="text-xs text-muted">{item.label}</p>
                <p className="mt-1 text-xl font-semibold text-ink">{formatCompact(item.value)}</p>
              </div>
            ))}
            <p className="col-span-full flex items-center gap-2 text-xs text-muted"><ShoppingBag aria-hidden className="size-3.5" />历史付费用户 {formatCount(data.totals.payingUsersAllTime)} 人 · 区间内分享页访问 {formatCount(now.shareVisits)} 次</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="最近管理操作" actions={<Link href="/admin/audit" className="text-xs text-ink-2 hover:text-ink">全部审计</Link>} />
          <CardBody className="pt-2">
            {data.audit.length ? (
              <ul className="divide-y divide-line text-sm">
                {data.audit.map((item) => (
                  <li key={String(item.id)} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{auditActionLabel(item.action)}</span>
                      <span className="block truncate text-xs text-muted">{item.reason ? String(item.reason) : "—"}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted">
                      <span className="block">{formatRelative(item.created_at as string)}</span>
                      <Mono>{String(item.actor_id || "系统").slice(0, 8)}</Mono>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-8 text-center text-xs text-muted">还没有管理操作记录</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
