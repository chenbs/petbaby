import { ImageOff } from "lucide-react";

import { Card, EmptyState, PageHeader, Pagination, SegmentLinks, withQuery } from "@/components/admin/ui";
import { UploadReviewGrid, type ReviewItem } from "@/components/admin/upload-review-grid";
import { listUploads, UPLOAD_KIND_LABELS, UPLOAD_KINDS, type UploadKind, type UploadStatus } from "@/server/admin/uploads";
import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "图片审核" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUSES: Array<{ key: UploadStatus; label: string }> = [
  { key: "pending", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "removed", label: "已移除" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UploadsPage({ searchParams }: Props) {
  const actorId = await requireAdminPage("/admin/uploads");
  const params = await searchParams;
  const status = (STATUSES.some((item) => item.key === one(params.status)) ? one(params.status) : "pending") as UploadStatus;
  const kind = (UPLOAD_KINDS as readonly string[]).includes(one(params.kind) || "") ? (one(params.kind) as UploadKind) : undefined;
  const userId = UUID.test(one(params.user) || "") ? one(params.user) : undefined;
  const page = Number(one(params.page) || 1);
  const result = await listUploads({ status, kind, userId, page });
  const href = (next: Record<string, string | number | undefined>) => withQuery("/admin/uploads", { status, kind, user: userId, ...next });
  const items: ReviewItem[] = result.items.map((row) => ({
    kind: String(row.kind),
    kindLabel: UPLOAD_KIND_LABELS[row.kind as UploadKind] || String(row.kind),
    id: row.id ? String(row.id) : null,
    userId: String(row.user_id),
    userName: String(row.display_name || String(row.user_id).slice(0, 8)),
    petName: row.pet_name ? String(row.pet_name) : null,
    createdAt: new Date(row.created_at as string).toISOString(),
    status: (row.status as ReviewItem["status"]) || "pending",
    reason: row.reason ? String(row.reason) : null,
    userSuspended: Boolean(row.admin_suspended_at),
    userDeleted: Boolean(row.user_deleted_at),
  }));

  return (
    <>
      <PageHeader title="图片审核" description="用户上传的宠物照片、头像、主人照片与记录附图。点图片可多选后批量通过；发现违规可移除，必要时一并封禁账号。" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentLinks label="审核状态" active={status} items={STATUSES.map((item) => ({ key: item.key, label: item.label, href: withQuery("/admin/uploads", { status: item.key, kind, user: userId }) }))} />
        <SegmentLinks label="图片类型" active={kind || "all"} items={[{ key: "all", label: "全部类型", href: href({ kind: undefined, page: undefined }) }, ...UPLOAD_KINDS.map((key) => ({ key, label: UPLOAD_KIND_LABELS[key], href: href({ kind: key, page: undefined }) }))]} />
      </div>
      {userId ? <p className="mb-3 text-xs text-muted">只看用户 {userId.slice(0, 8)} 的上传 · <a className="text-accent hover:underline" href={href({ user: undefined, page: undefined })}>看全部用户</a></p> : null}
      <Card>
        {items.length ? (
          <>
            <UploadReviewGrid items={items} actorId={actorId} />
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(next) => href({ page: next })} />
          </>
        ) : (
          <EmptyState icon={ImageOff} title={status === "pending" ? "没有待审核的图片" : "没有记录"} description={status === "pending" ? "新上传的图片会出现在这里。" : undefined} />
        )}
      </Card>
    </>
  );
}
