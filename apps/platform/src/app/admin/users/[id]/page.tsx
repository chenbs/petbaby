import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { Badge, buttonClass, Card, CardBody, CardHeader, KeyValue, Mono, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/admin/ui";
import { auditActionLabel, GROWTH_KIND_LABELS, LEDGER_REASON_LABELS, LIFE_STAGE_LABELS, ORDER_KIND_LABELS, PROVIDER_LABELS, SPECIES_LABELS } from "@/lib/admin-labels";
import { formatCount, formatDate, formatDateTime, formatYuan } from "@/lib/admin-format";
import { getUserDetail } from "@/server/admin/console";
import { acquisitionChannelLabel } from "@/domain/acquisition";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "用户详情" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATION_LABELS: Record<string, string> = { image: "创意照片", layout: "排版玩法", video: "短片" };

type Props = { params: Promise<{ id: string }> };

export default async function UserDetailPage({ params }: Props) {
  const { id } = await params;
  const actorId = await requireAdminPage(`/admin/users/${id}`);
  if (!UUID.test(id)) notFound();
  const detail = await getUserDetail(id);
  if (!detail) notFound();
  const { user, wallet, stats } = detail;
  const name = String(user.display_name || user.account_name || "未命名用户");
  const suspended = Boolean(user.admin_suspended_at);
  const deleted = Boolean(user.deleted_at);

  return (
    <>
      <Link href="/admin/users" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"><ChevronLeft className="size-3.5" />用户列表</Link>
      <PageHeader
        title={name}
        description={`注册于 ${formatDateTime(user.created_at as string)}`}
        actions={
          <>
            <Link href={`/admin/uploads?status=approved&user=${id}`} className={buttonClass("ghost", "md")}>查看上传图片</Link>
            {!deleted ? (
              <ActionDialog
                label="补偿冻干"
                title={`给 ${name} 发放赠送冻干`}
                description="只能发「赠送所得」（带有效期），不能直接改余额 —— 余额只由流水推出。"
                endpoint="/api/admin/wallet"
                body={{ action: "grant_gift", userId: id }}
                fields={[
                  { name: "units", label: "颗数", type: "number", required: true, min: 1, max: 200, defaultValue: "5" },
                  { name: "days", label: "有效天数", type: "number", required: true, min: 1, max: 365, defaultValue: "30" },
                ]}
                reasonDefault=""
                confirmLabel="发放"
                success="冻干补偿已到账"
                variant="secondary"
                size="md"
              />
            ) : null}
            {!deleted && id !== actorId ? (
              <ActionDialog
                label={suspended ? "解封账号" : "封禁账号"}
                title={suspended ? `解封 ${name}` : `封禁 ${name}`}
                description={suspended ? "解封后用户可重新登录；之前被关闭的分享不会自动恢复。" : "封禁后用户无法登录、无法使用任何功能，作品、纪念空间与年度报告的公开分享会立即关闭。"}
                endpoint="/api/admin/users"
                body={{ action: suspended ? "reactivate" : "suspend", userId: id }}
                confirmLabel={suspended ? "解封" : "封禁"}
                success={suspended ? "账号已解封" : "账号已封禁，公开分享已关闭"}
                danger={!suspended}
                size="md"
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="账号" />
          <CardBody>
            <KeyValue items={[
              { label: "状态", value: deleted ? <Badge tone="neutral">已注销</Badge> : suspended ? <Badge tone="critical">已封禁</Badge> : <Badge tone="good">正常</Badge> },
              { label: "短 ID", value: user.invite_code ? <Mono>{String(user.invite_code)}</Mono> : "—" },
              { label: "用户 ID", value: <Mono>{id}</Mono> },
              { label: "登录方式", value: [user.wechat ? "微信" : null, user.password ? "账号密码" : null].filter(Boolean).join(" · ") || "—" },
              { label: "账号名", value: String(user.account_name || "—") },
              { label: "来源", value: [acquisitionChannelLabel(user.acquisition_channel), user.acquisition_src ? String(user.acquisition_src) : null, user.acquisition_scene ? `场景 ${String(user.acquisition_scene)}` : null].filter(Boolean).join(" · ") },
              ...(user.invited_by ? [{ label: "邀请人", value: <Link href={`/admin/users/${String(user.invited_by)}`} className="text-accent hover:underline"><Mono>{String(user.invited_by).slice(0, 8)}</Mono></Link> }] : []),
              { label: "邀请注册", value: `${formatCount(Number(user.invited_count || 0))} 人` },
              ...(suspended ? [{ label: "封禁原因", value: String(user.admin_suspension_reason || "—") }] : []),
              ...(deleted ? [{ label: "注销时间", value: formatDateTime(user.deleted_at as string) }] : []),
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="价值" />
          <CardBody>
            <KeyValue items={[
              { label: "累计实收", value: <b className="font-semibold">{formatYuan(stats.revenue as number)}</b> },
              { label: "冻干余额", value: `${formatCount(wallet.balance)} 颗` },
              { label: "累计消耗", value: `${formatCount(stats.spent as number)} 颗` },
              { label: "钱包状态", value: wallet.frozen ? <Badge tone="critical">已冻结</Badge> : "正常" },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="使用" />
          <CardBody>
            <KeyValue items={[
              { label: "照片", value: formatCount(stats.photos as number) },
              { label: "创意照片", value: formatCount(stats.ai_runs as number) },
              { label: "排版 / 短片", value: `${formatCount(stats.tasks as number)} / ${formatCount(stats.videos as number)}` },
              { label: "健康助手 / 日常记录", value: `${formatCount(stats.health as number)} / ${formatCount(stats.logs as number)}` },
            ]} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="宠物" description={`${detail.pets.length} 只`} />
          <CardBody className="px-0 pb-0 pt-3">
            {detail.pets.length ? (
              <Table>
                <thead><tr><Th>名字</Th><Th>物种</Th><Th>阶段</Th><Th align="right">照片</Th><Th align="right">记录</Th><Th>建档</Th></tr></thead>
                <tbody>{detail.pets.map((pet) => (
                  <Tr key={String(pet.id)} className={pet.deleted_at ? "opacity-50" : undefined}>
                    <Td className="font-medium">{String(pet.name)}{pet.deleted_at ? <span className="ml-2 text-xs text-muted">已删除</span> : null}</Td>
                    <Td>{SPECIES_LABELS[String(pet.species)] || String(pet.species)}</Td>
                    <Td>{LIFE_STAGE_LABELS[String(pet.life_stage)] || String(pet.life_stage)}</Td>
                    <Td align="right">{formatCount(pet.photos as number)}</Td>
                    <Td align="right">{formatCount(pet.logs as number)}</Td>
                    <Td className="text-ink-2">{formatDate(pet.created_at as string)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            ) : <p className="px-5 pb-6 text-xs text-muted">还没有宠物档案</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="最近创作" description="最近 20 条" />
          <CardBody className="px-0 pb-0 pt-3">
            {detail.creations.length ? (
              <Table>
                <thead><tr><Th>类型</Th><Th>玩法 / 模板</Th><Th>状态</Th><Th>时间</Th></tr></thead>
                <tbody>{detail.creations.map((item) => (
                  <Tr key={String(item.id)}>
                    <Td>{CREATION_LABELS[String(item.kind)]}</Td>
                    <Td><span className="text-ink">{String(item.detail || item.plugin_id)}</span>{item.error_code ? <Mono className="ml-2 text-critical-ink">{String(item.error_code)}</Mono> : null}</Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            ) : <p className="px-5 pb-6 text-xs text-muted">还没有创作</p>}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="支付流水" description="最近 20 笔" />
          <CardBody className="px-0 pb-0 pt-3">
            {detail.payments.length ? (
              <Table>
                <thead><tr><Th>商品</Th><Th>渠道</Th><Th align="right">金额</Th><Th>状态</Th><Th>时间</Th></tr></thead>
                <tbody>{detail.payments.map((item) => (
                  <Tr key={String(item.id)}>
                    <Td><span className="text-ink">{GROWTH_KIND_LABELS[String(item.growth_kind)] || ORDER_KIND_LABELS[String(item.order_kind)]}</span><Mono className="ml-2">{String(item.sku)}</Mono></Td>
                    <Td className="text-ink-2">{PROVIDER_LABELS[String(item.provider)] || String(item.provider)}</Td>
                    <Td align="right">{formatYuan(Number(item.amount_fen) / 100)}{Number(item.refunded_fen) ? <span className="block text-[11px] text-critical-ink">退 {formatYuan(Number(item.refunded_fen) / 100)}</span> : null}</Td>
                    <Td><StatusBadge status={item.status} /></Td>
                    <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            ) : <p className="px-5 pb-6 text-xs text-muted">没有支付记录</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="冻干流水" description="最近 30 条" />
          <CardBody className="px-0 pb-0 pt-3">
            {detail.ledger.length ? (
              <Table>
                <thead><tr><Th>事项</Th><Th>类型</Th><Th align="right">变动</Th><Th align="right">余额</Th><Th>时间</Th></tr></thead>
                <tbody>{detail.ledger.map((item) => (
                  <Tr key={String(item.id)}>
                    <Td className="max-w-56 truncate">{String(item.title)}</Td>
                    <Td className="text-ink-2">{LEDGER_REASON_LABELS[String(item.reason)] || String(item.reason)}</Td>
                    <Td align="right" className={Number(item.delta) > 0 ? "text-good-ink" : undefined}>{Number(item.delta) > 0 ? "+" : ""}{formatCount(item.delta as number)}</Td>
                    <Td align="right">{formatCount(item.balance_after as number)}</Td>
                    <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            ) : <p className="px-5 pb-6 text-xs text-muted">没有冻干流水</p>}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="入账批次" description="赠送所得有有效期，按先到期先扣" />
          <CardBody className="px-0 pb-0 pt-3">
            {detail.lots.length ? (
              <Table>
                <thead><tr><Th>来源</Th><Th align="right">剩余 / 入账</Th><Th>状态</Th><Th>到期</Th></tr></thead>
                <tbody>{detail.lots.map((lot) => (
                  <Tr key={String(lot.id)}>
                    <Td>{lot.pocket === "gift" ? "赠送" : "购买"} · {LEDGER_REASON_LABELS[String(lot.source)] || String(lot.source)}</Td>
                    <Td align="right">{formatCount(lot.remaining as number)} / {formatCount(lot.units as number)}</Td>
                    <Td><StatusBadge status={lot.status} /></Td>
                    <Td className="text-ink-2">{lot.expires_at ? formatDate(lot.expires_at as string) : "长期有效"}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            ) : <p className="px-5 pb-6 text-xs text-muted">没有入账批次</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="相关审计" />
          <CardBody className="pt-2">
            {detail.audit.length ? (
              <ul className="divide-y divide-line text-sm">
                {detail.audit.map((item) => (
                  <li key={String(item.id)} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="min-w-0"><span className="block text-ink">{auditActionLabel(item.action)}</span><span className="block truncate text-xs text-muted">{String(item.reason || "—")}</span></span>
                    <span className="shrink-0 text-xs text-muted">{formatDateTime(item.created_at as string)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-xs text-muted">没有针对该用户的管理操作</p>}
          </CardBody>
        </Card>
      </div>

      {detail.works.length ? (
        <Card className="mt-4">
          <CardHeader title="最近作品" description="最近 12 件" />
          <CardBody className="px-0 pb-0 pt-3">
            <Table>
              <thead><tr><Th>标题</Th><Th>玩法</Th><Th>状态</Th><Th>创建</Th><Th align="right">操作</Th></tr></thead>
              <tbody>{detail.works.map((work) => (
                <Tr key={String(work.id)}>
                  <Td className="font-medium">{String(work.title)}</Td>
                  <Td className="text-ink-2">{String(work.plugin_name)}</Td>
                  <Td>{work.public ? <Badge tone="info">公开分享中</Badge> : work.locked ? <Badge tone="neutral">未解锁</Badge> : <Badge tone="good">正式版</Badge>}</Td>
                  <Td className="text-ink-2">{formatDate(work.created_at as string)}</Td>
                  <Td align="right">{work.public ? <ActionDialog label="关闭分享" title="关闭这件作品的公开分享" description="分享链接立即失效，用户可以之后重新分享。" endpoint="/api/admin/operations" body={{ action: "close_share", workId: work.id }} danger confirmLabel="关闭分享" success="分享已关闭" /> : <span className="text-xs text-muted">—</span>}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
