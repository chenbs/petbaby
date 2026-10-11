import { CurationEditor } from "@/components/admin/curation-editor";
import { PageHeader } from "@/components/admin/ui";
import { petArtPhotoScenes } from "@/domain/pet-art-photo";
import { requireAdminPage } from "@/server/admin/page-guard";
import { getHomeCuration } from "@/server/home-curation-service";
import { imageTemplateEntries, listImageTemplates } from "@/server/image-template-registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "麻麻精选" };

export default async function CurationPage() {
  await requireAdminPage("/admin/curation");
  const curation = await getHomeCuration();
  const entryTitles = new Map<string, string>(imageTemplateEntries.map((entry) => [entry.id, entry.title]));
  // 只给上架模板做候选；服务端保存时还会再校验一次。
  const templates = listImageTemplates().map((template) => ({
    id: template.templateId,
    title: template.title,
    entry: entryTitles.get(template.entryId) || template.entryId,
    sample: template.sampleStorageKey ? `/api/image-templates/${encodeURIComponent(template.templateId)}/sample` : null,
  }));
  const scenes = petArtPhotoScenes.map((scene) => ({ id: scene.id, title: scene.title, description: scene.description }));
  return (
    <>
      <PageHeader title="麻麻精选" description="首页编辑推荐位：一张主推 + 若干模板 + 写真场景。保存即发布，小程序下次打开首页生效；版本号自增并写入审计。" />
      <CurationEditor initial={curation} templates={templates} scenes={scenes} />
    </>
  );
}
