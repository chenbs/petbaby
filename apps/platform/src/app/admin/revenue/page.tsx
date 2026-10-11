import Link from "next/link";
import { Coins, CreditCard, Gift, Percent, Users } from "lucide-react";

import { ChartFrame, StackedBars, TrendChart, type SeriesSpec } from "@/components/admin/charts";
import { RangePicker } from "@/components/admin/range-picker";
import { BarList, StatCard } from "@/components/admin/stat";
import { Card, CardBody, CardHeader, Mono, PageHeader, Table, Td, Th, Tr } from "@/components/admin/ui";
import { ORDER_KIND_LABELS, REVENUE_SOURCE_LABELS, SPEND_REF_LABELS } from "@/lib/admin-labels";
import { formatCount, formatDateTime, formatPercent, formatYuan } from "@/lib/admin-format";
import { describeRange, resolveAdminRange } from "@/lib/admin-range";
import { getRevenue, REVENUE_SOURCES } from "@/server/admin/analytics";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "收入与冻干" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 充值档 SKU → 展示名（真源在 server/wallet/topup.ts，这里只做展示映射） */
const PACKAGE_LABELS: Record<string, string> = {
  "fd-topup-6-first": "新人首充 ¥6 / 12 颗",
  "fd-topup-6": "¥6 / 6 颗",
  "fd-topup-18": "¥18 / 22 颗",
  "fd-topup-38": "¥38 / 50 颗",
  "fd-topup-68": "¥68 / 95 颗",
  "fd-topup-128": "¥128 / 188 颗",
};

export default async function RevenuePage({ searchParams }: Props) {
  await requireAdminPage("/admin/revenue");
  const range = resolveAdminRange(await searchParams);
  const data = await getRevenue(range);
  const { now, before } = data;
  // 收入来源固定分色：颜色写死在来源上（不随过滤后的位置变化），区间里没有的来源只是不画。
  const sourceSeries: SeriesSpec[] = REVENUE_SOURCES.map((source, index) => ({ key: source, label: REVENUE_SOURCE_LABELS[source], color: `var(--series-${index + 1})` }));
  const activeSeries = sourceSeries.filter((series) => data.sources.some((item) => item.source === series.key && item.amount > 0));
  const shownSeries = activeSeries.length ? sourceSeries.filter((series) => activeSeries.includes(series)) : sourceSeries.slice(0, 1);
  const economy = data.economyTotals;
  const netSpent = economy.spent - economy.returned;

  return (
    <>
      <PageHeader
        eyebrow={`${range.from} 至 ${range.to} · 北京时间`}
        title="收入与冻干"
        description="现金收入只计真实收款（充值、增值单、实体单、历史作品单）；冻干消耗是站内货币流转，单独统计，不重复计入收入。"
        actions={<RangePicker preset={range.preset} from={range.from} to={range.to} label={describeRange(range)} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard emphasis label="现金收入" icon={Coins} value={formatYuan(now.revenue, { compact: true })} current={now.revenue} previous={before.revenue} trend={data.daily.map((row) => REVENUE_SOURCES.reduce((sum, key) => sum + Number(row[key] || 0), 0))} hint={`净收入 ${formatYuan(now.revenue - now.refunds)}（扣退款 ${formatYuan(now.refunds)}）`} />
        <StatCard label="付费用户" icon={Users} value={formatCount(now.payingUsers)} current={now.payingUsers} previous={before.payingUsers} hint={`${formatCount(now.paidOrders)} 笔收款 · 首充 ${formatCount(data.firstTopups)} 人`} />
        <StatCard label="ARPPU" icon={CreditCard} value={formatYuan(data.arppu)} current={data.arppu} previous={data.previousArppu} hint="每位付费用户的平均实收" />
        <StatCard label="付费率" icon={Percent} value={formatPercent(data.payRate)} current={data.payRate ?? 0} previous={data.previousPayRate ?? 0} deltaFormat="points" hint="付费用户 / 活跃用户" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartFrame className="xl:col-span-2" title="每日收入构成" description="按收款来源堆叠" series={shownSeries} rows={data.daily as Array<Record<string, string | number>>} valueKind="yuan">
          <StackedBars rows={data.daily as Array<Record<string, string | number>>} series={shownSeries} valueKind="yuan" />
        </ChartFrame>
        <Card>
          <CardHeader title="收入来源" description={describeRange(range)} />
          <CardBody className="px-0 pb-0 pt-3">
            <Table>
              <thead><tr><Th>来源</Th><Th align="right">笔数</Th><Th align="right">人数</Th><Th align="right">金额</Th></tr></thead>
              <tbody>
                {data.sources.map((item) => (
                  <Tr key={item.source}>
                    <Td><span className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: `var(--series-${REVENUE_SOURCES.indexOf(item.source) + 1})` }} />{REVENUE_SOURCE_LABELS[item.source]}</span></Td>
                    <Td align="right">{formatCount(item.orders)}</Td>
                    <Td align="right">{formatCount(item.users)}</Td>
                    <Td align="right" className="font-medium">{formatYuan(item.amount)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="充值档分布" description="冻干充值单，按金额排序" />
          <CardBody className="pt-3">
            <BarList items={data.packages.map((item) => ({ key: item.sku, label: PACKAGE_LABELS[item.sku] || item.sku, value: item.amount, sub: `${formatCount(item.orders)} 笔 · ${formatCount(item.units)} 颗` }))} format={(value) => formatYuan(value)} emptyText="区间内没有充值" />
          </CardBody>
        </Card>
        <ChartFrame className="xl:col-span-2" title="冻干消耗" description="每日净消耗（消耗 − 失败退还），单位：颗" series={[{ key: "net", label: "净消耗" }]} rows={data.economy.map((row) => ({ day: row.day, net: row.spent - row.returned }))} valueKind="units">
          <TrendChart area rows={data.economy.map((row) => ({ day: row.day, net: row.spent - row.returned }))} series={[{ key: "net", label: "净消耗" }]} valueKind="units" height={220} />
        </ChartFrame>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="冻干收支" description={`${describeRange(range)} · 单位：颗`} />
          <CardBody className="pt-2">
            <dl className="divide-y divide-line text-sm">
              {[
                { label: "充值到账", value: economy.topup, sign: "+" },
                { label: "赠送（见面礼 + 补偿）", value: economy.gift, sign: "+" },
                { label: "消耗", value: economy.spent, sign: "−" },
                { label: "失败退还", value: economy.returned, sign: "+" },
                { label: "过期与退款回收", value: economy.expired, sign: "−" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2.5">
                  <dt className="text-ink-2">{item.label}</dt>
                  <dd className="font-medium text-ink tnum">{item.sign} {formatCount(item.value)}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-medium text-ink">净消耗</dt>
                <dd className="font-semibold text-ink tnum">{formatCount(netSpent)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="冻干余额负债" description="当前存量；购买所得按购入单价折算现金" actions={<Gift aria-hidden className="size-4 text-muted" />} />
          <CardBody className="space-y-4 pt-3">
            <div className="rounded-lg bg-surface-2 px-4 py-3">
              <p className="text-xs text-muted">购买所得剩余</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{formatCount(data.liability.purchasedUnits)} 颗</p>
              <p className="mt-0.5 text-xs text-muted">对应预收现金 {formatYuan(data.liability.purchasedAmount)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface-2 px-4 py-3"><p className="text-xs text-muted">赠送所得剩余</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(data.liability.giftUnits)} 颗</p></div>
              <div className="rounded-lg bg-surface-2 px-4 py-3"><p className="text-xs text-muted">7 天内过期</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(data.liability.giftExpiring)} 颗</p></div>
            </div>
            <p className="text-xs text-muted">持有余额的用户 {formatCount(data.liability.holders)} 人 · 区间内发放见面礼 {formatCount(data.newcomerGifts)} 人</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="消耗去向" description="按业务对象" />
          <CardBody className="pt-3"><BarList items={data.spend.map((item) => ({ key: item.refType, label: SPEND_REF_LABELS[item.refType] || item.refType, value: item.units, sub: `${formatCount(item.users)} 人 · ${formatCount(item.spends)} 次` }))} format={(value) => `${formatCount(value)} 颗`} emptyText="区间内没有消耗" /></CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="付费用户 Top 10" description={describeRange(range)} />
          <CardBody className="px-0 pb-0 pt-3">
            {data.payers.length ? (
              <Table>
                <thead><tr><Th>用户</Th><Th align="right">笔数</Th><Th align="right">实收</Th><Th align="right">最近付费</Th></tr></thead>
                <tbody>
                  {data.payers.map((item) => (
                    <Tr key={item.userId}>
                      <Td><Link href={`/admin/users/${item.userId}`} className="font-medium hover:underline">{item.displayName || "未命名用户"}</Link><Mono className="ml-2">{item.userId.slice(0, 8)}</Mono></Td>
                      <Td align="right">{formatCount(item.orders)}</Td>
                      <Td align="right" className="font-medium">{formatYuan(item.amount)}</Td>
                      <Td align="right" className="text-ink-2">{formatDateTime(item.lastPaidAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="px-5 pb-8 pt-4 text-center text-xs text-muted">区间内没有付费用户</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="退款" description="渠道确认成功的退款" />
          <CardBody className="space-y-3 pt-3">
            {data.refunds.length ? data.refunds.map((item) => (
              <div key={item.kind} className="flex items-center justify-between text-sm">
                <span className="text-ink-2">{ORDER_KIND_LABELS[item.kind] || item.kind}</span>
                <span className="text-ink tnum"><b className="font-semibold">{formatYuan(item.amount)}</b><span className="ml-2 text-xs text-muted">{item.refunds} 笔</span></span>
              </div>
            )) : <p className="py-6 text-center text-xs text-muted">区间内没有退款</p>}
            <p className="border-t border-line pt-3 text-xs text-muted">退款率 {now.revenue ? formatPercent(now.refunds / now.revenue) : "—"}（退款金额 / 收入）</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
