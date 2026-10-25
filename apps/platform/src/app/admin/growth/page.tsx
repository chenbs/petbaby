import { Activity, Repeat, UserPlus, Users } from "lucide-react";

import { ChartFrame, StackedBars, TrendChart } from "@/components/admin/charts";
import { RangePicker } from "@/components/admin/range-picker";
import { BarList, Funnel, StatCard } from "@/components/admin/stat";
import { Card, CardBody, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/admin/ui";
import { acquisitionChannelLabel } from "@/domain/acquisition";
import { LIFE_STAGE_LABELS, SPECIES_LABELS } from "@/lib/admin-labels";
import { formatCompact, formatCount, formatPercent, formatYuan } from "@/lib/admin-format";
import { describeRange, resolveAdminRange } from "@/lib/admin-range";
import { getGrowth } from "@/server/admin/analytics";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "用户增长" };

type ChannelRow = { key: string; registered: number; hasPet: number; spent: number; paid: number; revenue: number };

/** 渠道表：一行一个渠道或投放标记，转化率都以该行注册人数为分母。 */
function ChannelTable({ rows, label, labelFor }: { rows: ChannelRow[]; label: string; labelFor: (key: string) => string }) {
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted">区间内没有新注册用户</p>;
  return (
    <Table>
      <thead>
        <tr><Th>{label}</Th><Th align="right">注册</Th><Th align="right">建档率</Th><Th align="right">消耗冻干</Th><Th align="right">付费人数</Th><Th align="right">累计实收</Th><Th align="right">人均实收</Th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td>{labelFor(row.key)}</Td>
            <Td align="right">{formatCount(row.registered)}</Td>
            <Td align="right">{formatPercent(row.registered ? row.hasPet / row.registered : 0, 0)}</Td>
            <Td align="right">{formatCount(row.spent)}</Td>
            <Td align="right">{formatCount(row.paid)}</Td>
            <Td align="right">{formatYuan(row.revenue)}</Td>
            <Td align="right">{formatYuan(row.registered ? row.revenue / row.registered : 0)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 留存热力图的单色阶（蓝，浅 → 深）。格子文字色按每阶实测对比度在 admin.css 里逐阶指定（--seq-text-N）。 */
const HEAT_STEPS = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)", "var(--seq-6)"];

function heat(rate: number) {
  const index = Math.min(HEAT_STEPS.length - 1, Math.floor(rate * HEAT_STEPS.length));
  return { background: HEAT_STEPS[index], color: `var(--seq-text-${index + 1})` };
}

export default async function GrowthPage({ searchParams }: Props) {
  await requireAdminPage("/admin/growth");
  const range = resolveAdminRange(await searchParams);
  const data = await getGrowth(range);
  const { now, before, daily, stickiness, retention, base } = data;
  const maxWeeks = Math.max(1, ...data.cohorts.map((cohort) => cohort.weeks.length));

  return (
    <>
      <PageHeader
        eyebrow={`${range.from} 至 ${range.to} · 北京时间`}
        title="用户增长"
        description="新增、活跃、留存与激活漏斗。活跃口径：有任意创作、上传、日常记录、健康助手、趣测或埋点行为。"
        actions={<RangePicker preset={range.preset} from={range.from} to={range.to} label={describeRange(range)} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="新增用户" icon={UserPlus} value={formatCompact(now.newUsers)} current={now.newUsers} previous={before.newUsers} trend={daily.map((row) => row.newUsers)} />
        <StatCard label="活跃用户" icon={Users} value={formatCompact(now.activeUsers)} current={now.activeUsers} previous={before.activeUsers} trend={daily.map((row) => row.activeUsers)} />
        <StatCard label="次日留存" icon={Repeat} value={formatPercent(retention.d1)} hint={retention.d1Base ? `基于 ${formatCount(retention.d1Base)} 位已满一天的新用户` : "区间内还没有满一天的新用户"} />
        <StatCard label="7 日内回访" icon={Activity} value={formatPercent(retention.d7)} hint={retention.d7Base ? `基于 ${formatCount(retention.d7Base)} 位已满 7 天的新用户` : "区间内还没有满 7 天的新用户"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartFrame className="xl:col-span-2" title="每日新增与活跃" description="两条线共用同一纵轴（人数）" series={[{ key: "activeUsers", label: "活跃用户" }, { key: "newUsers", label: "新增用户" }]} rows={daily}>
          <TrendChart rows={daily} series={[{ key: "activeUsers", label: "活跃用户" }, { key: "newUsers", label: "新增用户" }]} />
        </ChartFrame>
        <Card>
          <CardHeader title="粘性" description={`截至 ${range.to}`} />
          <CardBody className="space-y-4 pt-3">
            {[
              { label: "日活 DAU", value: stickiness.dau },
              { label: "周活 WAU（近 7 天）", value: stickiness.wau },
              { label: "月活 MAU（近 30 天）", value: stickiness.mau },
            ].map((item) => (
              <div key={item.label} className="flex items-baseline justify-between">
                <span className="text-sm text-ink-2">{item.label}</span>
                <span className="text-xl font-semibold text-ink">{formatCount(item.value)}</span>
              </div>
            ))}
            <div className="rounded-lg bg-surface-2 px-4 py-3">
              <p className="text-xs text-muted">DAU / MAU</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{stickiness.mau ? formatPercent(stickiness.dau / stickiness.mau) : "—"}</p>
              <p className="mt-1 text-xs text-muted">越高说明月活用户里每天回来的越多</p>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader title="新用户激活漏斗" description={`${describeRange(range)}注册的用户，截至今天做到每一步的人数`} />
          <CardBody className="pt-4"><Funnel steps={data.funnel} /></CardBody>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title="周留存" description="按注册周（周一起）分组，第 N 周仍有行为的用户占比" />
          <CardBody className="pt-3">
            {data.cohorts.length ? (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-max border-separate border-spacing-[2px] text-xs">
                  <thead>
                    <tr className="text-muted">
                      <th scope="col" className="px-2 py-1.5 text-left font-medium">注册周</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">人数</th>
                      {Array.from({ length: maxWeeks }, (_, index) => <th scope="col" key={index} className="px-2 py-1.5 text-center font-medium">{index === 0 ? "当周" : `第 ${index} 周`}</th>)}
                    </tr>
                  </thead>
                  <tbody className="tnum">
                    {data.cohorts.map((cohort) => (
                      <tr key={cohort.cohort}>
                        <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal text-ink-2">{cohort.cohort}</th>
                        <td className="px-2 py-1.5 text-right text-ink">{formatCount(cohort.size)}</td>
                        {Array.from({ length: maxWeeks }, (_, index) => {
                          if (index >= cohort.weeks.length) return <td key={index} className="rounded bg-surface-2/50" aria-label="尚未到达" />;
                          const rate = cohort.size ? cohort.weeks[index] / cohort.size : 0;
                          const tone = heat(rate);
                          return (
                            <td key={index} title={`${cohort.weeks[index]} / ${cohort.size} 人`} className="min-w-14 rounded px-2 py-1.5 text-center font-medium" style={{ background: tone.background, color: tone.color }}>
                              {formatPercent(rate, 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted" aria-hidden>
                  <span>0%</span>
                  <span className="flex">{HEAT_STEPS.map((color) => <span key={color} className="h-2 w-6" style={{ background: color }} />)}</span>
                  <span>100%</span>
                </div>
              </div>
            ) : <p className="py-10 text-center text-xs text-muted">最近 8 周还没有新注册用户</p>}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartFrame className="lg:col-span-2" title="付费用户日分布" description="每日有实际收款的用户数" series={[{ key: "payingUsers", label: "付费用户" }]} rows={daily}>
          <StackedBars rows={daily} series={[{ key: "payingUsers", label: "付费用户" }]} height={200} />
        </ChartFrame>
        <Card>
          <CardHeader title="用户与宠物结构" description="当前存量" />
          <CardBody className="space-y-5 pt-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-surface-2 py-3"><p className="text-xs text-muted">有宠物档案</p><p className="mt-1 text-lg font-semibold text-ink">{base.users ? formatPercent(base.withPet / base.users, 0) : "—"}</p></div>
              <div className="rounded-lg bg-surface-2 py-3"><p className="text-xs text-muted">已封禁</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(base.suspended)}</p></div>
              <div className="rounded-lg bg-surface-2 py-3"><p className="text-xs text-muted">已注销</p><p className="mt-1 text-lg font-semibold text-ink">{formatCount(base.deleted)}</p></div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">物种</p>
              <BarList items={base.species.map((item) => ({ key: item.key, label: SPECIES_LABELS[item.key] || item.key, value: item.count }))} format={formatCount} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">生命阶段</p>
              <BarList items={base.stages.map((item) => ({ key: item.key, label: LIFE_STAGE_LABELS[item.key] || item.key, value: item.count }))} format={formatCount} />
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted">每位用户的宠物数</p>
              <BarList items={base.petsPerUser.map((item) => ({ key: item.key, label: item.key, value: item.count }))} format={(value) => `${formatCount(value)} 人`} />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="新用户来源" description={`${describeRange(range)}注册的用户按首次进入的微信场景归类；付费与实收统计到今天`} />
          <CardBody className="pt-1"><ChannelTable rows={data.channels} label="渠道" labelFor={(key) => acquisitionChannelLabel(key)} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="邀请奖励" description={describeRange(range)} />
          <CardBody className="space-y-3 pt-3">
            {[
              { label: "已结算邀请（建好档案）", value: data.invites.granted + data.invites.capped },
              { label: "其中超出每日上限未发", value: data.invites.capped },
              { label: "发出冻干（颗）", value: data.invites.units },
              { label: "拿到奖励的邀请人", value: data.invites.inviters },
            ].map((item) => (
              <div key={item.label} className="flex items-baseline justify-between">
                <span className="text-sm text-ink-2">{item.label}</span>
                <span className="text-xl font-semibold text-ink">{formatCount(item.value)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="投放标记" description="小程序路径或小程序码里带的 src 参数（如 xhs-1012-human），最多列 30 个" />
        <CardBody className="pt-1"><ChannelTable rows={data.sources} label="src" labelFor={(key) => key} /></CardBody>
      </Card>
    </>
  );
}
