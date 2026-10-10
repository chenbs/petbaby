import { NextResponse } from "next/server";

import {
  duoPhotoGroups,
  getImageTemplateCandidateCount,
  imageTemplateSupportsReroll,
  listPublicImageTemplateEntries,
} from "@/server/image-template-registry";
import { AI_RUN_COST } from "@/domain/dongan-pricing";

const duoGroupById = new Map<string, (typeof duoPhotoGroups)[number]>(duoPhotoGroups.map((group) => [group.id, group]));

export async function GET() {
  const entries = listPublicImageTemplateEntries().map((entry) => ({
    ...entry,
    templates: entry.templates.map((template) => ({
      entryId: template.entryId,
      templateId: template.templateId,
      title: template.title,
      tags: template.tags || [],
      // 人宠写真按组展示：组名与一句话说明由服务端下发，端上不写死
      groupId: template.groupId,
      groupTitle: template.groupId ? duoGroupById.get(template.groupId)?.title : undefined,
      groupDescription: template.groupId ? duoGroupById.get(template.groupId)?.description : undefined,
      subjectMode: template.subjectMode,
      orientation: template.orientation,
      size: template.size,
      version: template.version,
      status: template.status,
      candidateCount: getImageTemplateCandidateCount(template),
      rerollSupported: imageTemplateSupportsReroll(template),
      // 每拍一张扣的冻干颗数（2026-10-08）。端上只读这里，不写死。
      donganCost: AI_RUN_COST[template.subjectMode] ?? AI_RUN_COST.pet,
      sampleUrl: `/api/image-templates/${encodeURIComponent(template.templateId)}/sample`,
    })),
  }));
  return NextResponse.json({ data: { entries } });
}
