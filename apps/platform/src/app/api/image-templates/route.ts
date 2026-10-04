import { NextResponse } from "next/server";

import {
  getImageTemplateCandidateCount,
  imageTemplateSupportsReroll,
  listPublicImageTemplateEntries,
} from "@/server/image-template-registry";

export async function GET() {
  const entries = listPublicImageTemplateEntries().map((entry) => ({
    ...entry,
    templates: entry.templates.map((template) => ({
      entryId: template.entryId,
      templateId: template.templateId,
      title: template.title,
      tags: template.tags || [],
      subjectMode: template.subjectMode,
      orientation: template.orientation,
      size: template.size,
      version: template.version,
      status: template.status,
      candidateCount: getImageTemplateCandidateCount(template),
      rerollSupported: imageTemplateSupportsReroll(template),
      sampleUrl: `/api/image-templates/${encodeURIComponent(template.templateId)}/sample`,
    })),
  }));
  return NextResponse.json({ data: { entries } });
}
