import Link from "next/link";
import { Clapperboard } from "lucide-react";

import { ActionDialog } from "@/components/admin/action-dialog";
import { Badge, Card, CardBody, CardHeader, EmptyState, Mono, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin-format";
import { requireAdminPage } from "@/server/admin/page-guard";
import { getDatabase } from "@/server/db/client";
import { listVideoCatalog } from "@/server/video/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "视频目录" };

const KIND_LABELS: Record<string, string> = { template: "模板", font: "字体", bgm: "BGM", transition: "转场", asset: "素材" };

export default async function VideoAdminPage() {
  await requireAdminPage("/admin/video");
  // listVideoCatalog 只返回启用中的版本；后台要看全部版本，包括已停用的。
  await listVideoCatalog();
  const catalog = await (await getDatabase()).query("SELECT * FROM video_catalog_items ORDER BY kind, code, version DESC");
  const groups = Object.keys(KIND_LABELS).map((kind) => ({ kind, items: catalog.filter((item) => item.kind === kind) })).filter((group) => group.items.length);

  return (
    <>
      <PageHeader
        title="视频目录"
        description="短片使用的模板、字体、BGM、转场与素材。每次修改都是新版本，旧版本可重新发布；渲染任务的处理在「任务监控 → 短片渲染」。"
        actions={
          <>
            <Link href="/admin/tasks?kind=video" className="text-sm text-ink-2 hover:text-ink">查看渲染任务</Link>
            <ActionDialog
              label="发布新版本"
              title="发布视频目录版本"
              description="同类型同编码会自增版本号。"
              endpoint="/api/admin/video"
              body={{ status: "active", isDefault: false }}
              fields={[
                { name: "kind", label: "类型", type: "select", options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })) },
                { name: "code", label: "编码", required: true, maxLength: 80 },
                { name: "label", label: "名称", required: true, maxLength: 80 },
                { name: "config", label: "配置 JSON", type: "json", defaultValue: "{}" },
              ]}
              reasonField={false}
              variant="primary"
              size="md"
              success="目录版本已发布"
            />
          </>
        }
      />
      {groups.length ? (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.kind}>
              <CardHeader title={KIND_LABELS[group.kind]} description={`${group.items.length} 个版本`} />
              <CardBody className="px-0 pb-0 pt-3">
                <Table>
                  <thead><tr><Th>名称</Th><Th>编码 / 版本</Th><Th>状态</Th><Th>发布时间</Th><Th align="right">操作</Th></tr></thead>
                  <tbody>{group.items.map((item) => (
                    <Tr key={String(item.id)}>
                      <Td className="font-medium">{String(item.label)}</Td>
                      <Td><Mono>{String(item.code)} v{String(item.version)}</Mono></Td>
                      <Td><span className="inline-flex items-center gap-2"><StatusBadge status={item.status} />{item.is_default ? <Badge tone="info" dot={false}>默认</Badge> : null}</span></Td>
                      <Td className="text-ink-2">{formatDateTime(item.created_at as string)}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1.5">
                          <ActionDialog label={item.status === "active" ? "停用" : "启用"} title={`${item.status === "active" ? "停用" : "启用"} ${String(item.label)} v${String(item.version)}`} endpoint="/api/admin/video" method="PATCH" body={{ action: "set_status", id: item.id, status: item.status === "active" ? "paused" : "active" }} danger={item.status === "active"} reasonDefault="视频运营调整" success="状态已更新" />
                          {item.status === "active" && !item.is_default ? <ActionDialog label="设为默认" title={`把 ${String(item.label)} v${String(item.version)} 设为默认`} endpoint="/api/admin/video" method="PATCH" body={{ action: "set_default", id: item.id }} reasonDefault="视频运营调整" success="已设为默认" /> : null}
                          <ActionDialog label="重新发布" title="把这个版本重新发布为最新版本" endpoint="/api/admin/video" method="PATCH" body={{ action: "rollback", id: item.id }} reasonDefault="回滚到历史版本" success="已重新发布" />
                        </div>
                      </Td>
                    </Tr>
                  ))}</tbody>
                </Table>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : <Card><EmptyState icon={Clapperboard} title="视频目录为空" /></Card>}
    </>
  );
}
