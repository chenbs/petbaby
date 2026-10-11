import Link from "next/link";
import { Flower2 } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { FilterBar } from "@/components/admin/filter-bar";
import { Badge, Card, CardBody, CardHeader, EmptyState, Mono, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin-format";
import { requireAdminPage } from "@/server/admin/page-guard";
import { listMemorialAdmin } from "@/server/memorial-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "纪念空间" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const KIND_LABELS: Record<string, string> = { theme: "主题", template: "模板", bgm: "BGM", asset: "素材" };
const PRODUCT_LABELS: Record<string, string> = { album: "纪念册", video: "纪念短片", stardust: "星尘页" };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MemorialsAdminPage({ searchParams }: Props) {
  await requireAdminPage("/admin/memorials");
  const params = await searchParams;
  const lifecycle = ["active", "hidden", "restored"].includes(one(params.lifecycle) || "") ? one(params.lifecycle) : undefined;
  const visibility = ["private", "shared"].includes(one(params.visibility) || "") ? one(params.visibility) : undefined;
  const data = await listMemorialAdmin({ lifecycle, visibility, pageSize: 60 });

  return (
    <>
      <PageHeader title="纪念空间" description="已离开的宠物的纪念空间。这里只处理分享与生成故障，不展示用户写下的故事正文。" />

      <Card>
        <CardHeader
          title="空间"
          description={`${data.spaces.length} 个`}
          actions={<FilterBar
            action="/admin/memorials"
            placeholder="（按状态筛选）"
            selects={[
              { name: "lifecycle", label: "生命周期", value: lifecycle, options: [{ value: "", label: "全部" }, { value: "active", label: "正常" }, { value: "hidden", label: "已隐藏" }, { value: "restored", label: "已恢复" }] },
              { name: "visibility", label: "可见性", value: visibility, options: [{ value: "", label: "全部" }, { value: "private", label: "私密" }, { value: "shared", label: "公开分享" }] },
            ]}
          />}
        />
        <CardBody className="px-0 pb-0">
          {data.spaces.length ? (
            <Table>
              <thead><tr><Th>空间</Th><Th>状态</Th><Th>产物</Th><Th>纪念短片</Th><Th>更新</Th><Th align="right">操作</Th></tr></thead>
              <tbody>{data.spaces.map((space) => {
                const jobs = (typeof space.product_jobs === "string" ? JSON.parse(space.product_jobs) : space.product_jobs || {}) as Record<string, { status?: string }>;
                return (
                  <Tr key={String(space.id)}>
                    <Td><span className="font-medium">{String(space.title)}</span><Link href={`/admin/users/${space.user_id}`} className="ml-2 hover:underline"><Mono>{String(space.user_id).slice(0, 8)}</Mono></Link></Td>
                    <Td><span className="inline-flex items-center gap-2"><StatusBadge status={space.lifecycle} /><StatusBadge status={space.visibility} /></span></Td>
                    <Td className="text-xs text-ink-2">{Object.entries(jobs).map(([key, job]) => `${PRODUCT_LABELS[key] || key}：${job?.status || "—"}`).join(" · ") || "—"}</Td>
                    <Td>{space.video_status ? <><StatusBadge status={space.video_status} />{space.video_error ? <Mono className="ml-2 text-critical-ink">{String(space.video_error)}</Mono> : null}</> : <span className="text-xs text-muted">—</span>}</Td>
                    <Td className="text-ink-2">{formatDateTime(space.updated_at as string)}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1.5">
                        {space.visibility === "shared" ? <ActionDialog label="关闭分享" title={`关闭「${String(space.title)}」的公开分享`} description="分享链接立即失效；用户可以之后重新开启。" endpoint="/api/admin/memorials" method="PATCH" body={{ action: "close_share", id: space.id }} danger reasonDefault="纪念产品运营调整" success="分享已关闭" /> : null}
                        {["failed", "cancelled"].includes(String(space.video_status || "")) ? <ActionDialog label="重试短片" title="重试纪念短片" endpoint="/api/admin/memorials" method="PATCH" body={{ action: "retry_video", id: space.id }} reasonDefault="后台重试纪念短片" success="已重新排队" /> : null}
                        {space.visibility !== "shared" && !["failed", "cancelled"].includes(String(space.video_status || "")) ? <span className="text-xs text-muted">—</span> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}</tbody>
            </Table>
          ) : <EmptyState icon={Flower2} title="没有符合条件的纪念空间" />}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="主题、模板与素材"
          actions={<ActionDialog
            label="发布目录版本"
            title="发布纪念目录版本"
            endpoint="/api/admin/memorials"
            body={{ config: {}, status: "active", isDefault: false }}
            fields={[
              { name: "kind", label: "类型", type: "select", options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })) },
              { name: "code", label: "编码", required: true, maxLength: 80 },
              { name: "label", label: "名称", required: true, maxLength: 80 },
            ]}
            reasonField={false}
            variant="primary"
            success="目录版本已发布"
          />}
        />
        <CardBody className="px-0 pb-0 pt-3">
          <Table>
            <thead><tr><Th>类型</Th><Th>名称</Th><Th>编码 / 版本</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
            <tbody>{data.catalog.map((item) => (
              <Tr key={String(item.id)}>
                <Td className="text-ink-2">{KIND_LABELS[String(item.kind)] || String(item.kind)}</Td>
                <Td className="font-medium">{String(item.label)}</Td>
                <Td><Mono>{String(item.code)} v{String(item.version)}</Mono></Td>
                <Td><span className="inline-flex items-center gap-2"><StatusBadge status={item.status} />{item.is_default ? <Badge tone="info" dot={false}>默认</Badge> : null}</span></Td>
                <Td align="right">
                  <div className="flex justify-end gap-1.5">
                    <ActionDialog label={item.status === "active" ? "停用" : "启用"} title={`${item.status === "active" ? "停用" : "启用"} ${String(item.label)}`} endpoint="/api/admin/memorials" method="PATCH" body={{ action: "catalog_status", id: item.id, status: item.status === "active" ? "paused" : "active" }} danger={item.status === "active"} reasonDefault="纪念产品运营调整" success="状态已更新" />
                    {item.status === "active" && !item.is_default ? <ActionDialog label="设为默认" title={`把 ${String(item.label)} 设为默认`} endpoint="/api/admin/memorials" method="PATCH" body={{ action: "catalog_default", id: item.id }} reasonDefault="纪念产品运营调整" success="已设为默认" /> : null}
                    <ActionDialog label="重新发布" title="把这个版本重新发布为最新版本" endpoint="/api/admin/memorials" method="PATCH" body={{ action: "catalog_rollback", id: item.id }} reasonDefault="回滚到历史版本" success="已重新发布" />
                  </div>
                </Td>
              </Tr>
            ))}</tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
