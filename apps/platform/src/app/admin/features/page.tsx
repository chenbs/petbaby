import { HeartPulse, Share2 } from "lucide-react";

import { ChartFrame, StackedBars, type SeriesSpec } from "@/components/admin/charts";
import { RangePicker } from "@/components/admin/range-picker";
import { BarList } from "@/components/admin/stat";
import { Card, CardBody, CardHeader, Delta, Mono, PageHeader, Table, Td, Th, Tr } from "@/components/admin/ui";
import { SPEND_REF_LABELS, TRIAGE_LABELS } from "@/lib/admin-labels";
import { formatCount, formatPercent } from "@/lib/admin-format";
import { describeRange, resolveAdminRange } from "@/lib/admin-range";
import { getFeatures } from "@/server/admin/analytics";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "功能使用" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FeaturesPage({ searchParams }: Props) {
  await requireAdminPage("/admin/features");
  const range = resolveAdminRange(await searchParams);
  const data = await getFeatures(range);
  // 系列固定（创作四线 + 陪伴类合并），颜色跟着业务线走，换区间不换色。
  const series: SeriesSpec[] = [...data.series, ...(data.hasOther ? [{ key: "other", label: "陪伴与趣测" }] : [])];
  const healthTotal = data.health.reduce((sum, item) => sum + item.sessions, 0);
  const healthByLevel = new Map<string, number>();
  for (const item of data.health) healthByLevel.set(item.level, (healthByLevel.get(item.level) || 0) + item.sessions);
  const keywordHits = data.health.filter((item) => item.source === "keyword").reduce((sum, item) => sum + item.sessions, 0);

  return (
    <>
      <PageHeader
        eyebrow={`${range.from} 至 ${range.to} · 北京时间`}
        title="功能使用"
        description="每条业务线的使用量、使用人数与成功率，以及模板、玩法维度的排行。"
        actions={<RangePicker preset={range.preset} from={range.from} to={range.to} label={describeRange(range)} />}
      />

      <Card>
        <Table>
          <thead>
            <tr><Th>功能</Th><Th align="right">使用次数</Th><Th align="right">环比</Th><Th align="right">使用人数</Th><Th align="right">人均</Th><Th align="right">成功</Th><Th align="right">失败</Th><Th align="right">成功率</Th></tr>
          </thead>
          <tbody>
            {data.summary.map((item) => (
              <Tr key={item.key}>
                <Td className="font-medium">{item.label}</Td>
                <Td align="right">{formatCount(item.uses)}</Td>
                <Td align="right"><Delta current={item.uses} previous={item.previousUses} /></Td>
                <Td align="right">{formatCount(item.users)}</Td>
                <Td align="right">{item.users ? (item.uses / item.users).toFixed(1) : "—"}</Td>
                <Td align="right">{formatCount(item.succeeded)}</Td>
                <Td align="right" className={item.failed ? "text-critical-ink" : undefined}>{formatCount(item.failed)}</Td>
                <Td align="right">{["records", "funtest", "memorial"].includes(item.key) ? "—" : formatPercent(item.successRate)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <ChartFrame className="mt-4" title="每日使用量构成" description="四条创作线单独着色；健康助手、日常记录、趣测与纪念空间合并为「陪伴与趣测」" series={series} rows={data.daily as Array<Record<string, string | number>>}>
        <StackedBars rows={data.daily as Array<Record<string, string | number>>} series={series} />
      </ChartFrame>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="创意照片模板排行" description="前 20 个模板（不含写真套餐内的单张）" />
          <CardBody className="px-0 pb-0 pt-3">
            {data.templates.length ? (
              <Table>
                <thead><tr><Th>模板</Th><Th>入口</Th><Th align="right">次数</Th><Th align="right">人数</Th><Th align="right">重拍</Th><Th align="right">成功率</Th></tr></thead>
                <tbody>
                  {data.templates.map((item) => (
                    <Tr key={item.templateId || "unknown"}>
                      <Td><span className="font-medium">{item.title}</span><Mono className="ml-2">{item.templateId}</Mono></Td>
                      <Td className="text-ink-2">{item.entry}</Td>
                      <Td align="right">{formatCount(item.uses)}</Td>
                      <Td align="right">{formatCount(item.users)}</Td>
                      <Td align="right">{formatCount(item.rerolls)}</Td>
                      <Td align="right">{formatPercent(item.successRate)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="px-5 pb-8 pt-4 text-center text-xs text-muted">区间内还没有创意照片</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="创作页分段" description="按模板所属入口汇总" />
          <CardBody className="pt-3"><BarList items={data.entries.map((item) => ({ key: item.entry, label: item.entry, value: item.uses }))} format={formatCount} /></CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="排版玩法" description="证件照、海报、画册、成长对比等" />
          <CardBody className="pt-3"><BarList items={data.layouts.map((item) => ({ key: item.pluginId, label: item.name, value: item.uses, sub: `${formatCount(item.users)} 人 · 失败 ${item.failed}` }))} format={formatCount} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="短片" description="记忆、年度、纪念三类" />
          <CardBody className="pt-3"><BarList items={data.videos.map((item) => ({ key: item.kind, label: item.label, value: item.uses, sub: `${formatCount(item.users)} 人 · 失败 ${item.failed}` }))} format={formatCount} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="冻干消耗去向" description="按业务对象，未扣除失败退还" />
          <CardBody className="pt-3"><BarList items={data.spend.map((item) => ({ key: item.refType, label: SPEND_REF_LABELS[item.refType] || item.refType, value: item.units, sub: `${formatCount(item.spends)} 次` }))} format={(value) => `${formatCount(value)} 颗`} /></CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="健康助手分级" description="分诊不是诊断；关键词直通不经过模型" actions={<HeartPulse aria-hidden className="size-4 text-muted" />} />
          <CardBody className="space-y-4 pt-3">
            <BarList items={["emergency", "urgent_24h", "observe", "routine"].map((level) => ({ key: level, label: TRIAGE_LABELS[level], value: healthByLevel.get(level) || 0 }))} format={formatCount} emptyText="区间内没有健康助手记录" />
            <p className="text-xs text-muted">共 {formatCount(healthTotal)} 次，其中关键词直通 {formatCount(keywordHits)} 次（{healthTotal ? formatPercent(keywordHits / healthTotal) : "—"}）</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="日常记录类型" />
          <CardBody className="pt-3"><BarList items={data.records.map((item) => ({ key: item.kind, label: item.label, value: item.logs, sub: `${formatCount(item.users)} 人` }))} format={formatCount} emptyText="区间内没有日常记录" /></CardBody>
        </Card>
        <Card>
          <CardHeader title="趣测与分享" actions={<Share2 aria-hidden className="size-4 text-muted" />} />
          <CardBody className="space-y-5 pt-3">
            <BarList items={data.funTests.map((item) => ({ key: item.testId, label: item.title, value: item.results, sub: `${formatCount(item.users)} 人` }))} format={formatCount} emptyText="区间内没有趣测结果" />
            <div className="grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
              <div><p className="text-xs text-muted">发起分享</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(data.shares.shares)}</p></div>
              <div><p className="text-xs text-muted">分享页访问</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(data.shares.visits)}</p></div>
              <div><p className="text-xs text-muted">独立访客</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(data.shares.visitors)}</p></div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="失败原因 Top 12" description="定位出图、排版、渲染失败的主要错误码" />
        <CardBody className="px-0 pb-0 pt-3">
          {data.errors.length ? (
            <Table>
              <thead><tr><Th>业务</Th><Th>错误码</Th><Th align="right">次数</Th></tr></thead>
              <tbody>{data.errors.map((item) => <Tr key={`${item.source}-${item.errorCode}`}><Td>{item.source}</Td><Td><Mono>{item.errorCode}</Mono></Td><Td align="right">{formatCount(item.failures)}</Td></Tr>)}</tbody>
            </Table>
          ) : <p className="px-5 pb-8 pt-4 text-center text-xs text-muted">区间内没有失败任务</p>}
        </CardBody>
      </Card>
    </>
  );
}
