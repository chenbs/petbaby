import "server-only";

import { z } from "zod";

import { getDatabase } from "@/server/db/client";
import { getImageTemplate } from "@/server/image-template-registry";
import { PET_ART_PHOTO_SCENE_IDS, type PetArtPhotoSceneId } from "@/domain/pet-art-photo";
import { AppError } from "@/server/errors";
import { recordAdminAudit } from "@/server/admin/audit";

/*
 * 麻麻精选（首页编辑推荐位）配置。
 *
 * 「麻麻」是用户本人的昵称视角，所以这是品牌语气的编辑推荐，不是一个分类：
 * 跨分类挑当周最好玩的内容。原先写死在小程序代码里，改一次要发版；
 * 现在存在 home_curation 单行表，后台可编辑、带版本号和审计。
 *
 * 默认值与小程序 services/home-effect-ids.js 保持一致，表为空时两端结果相同。
 */
export const DEFAULT_HOME_CURATION = {
  lead: { templateId: "animal-car-window-westie", title: "车窗风中写真", subtitle: "风吹起来的这一刻，也值得留下" },
  templateIds: ["fish-chase", "character-outfit-grid", "animal-sword-cat-alt", "travel-glass-summer", "pet-milk-tea-shopkeeper", "fun-fisheye-closeup", "mini-companion", "animal-pink-scooter"],
  sceneIds: ["window-morning", "seaside-breeze", "library-whisper", "autumn-leaves", "berry-pastry-chef", "ballet-backstage"] as PetArtPhotoSceneId[],
  note: "每周更新",
};

const curationSchema = z.object({
  lead: z.object({ templateId: z.string().min(1), title: z.string().trim().min(1).max(20), subtitle: z.string().trim().max(40).default("") }),
  templateIds: z.array(z.string().min(1)).min(1).max(12),
  sceneIds: z.array(z.enum(PET_ART_PHOTO_SCENE_IDS)).max(12),
  note: z.string().trim().max(12).default("每周更新"),
});

export type HomeCuration = z.infer<typeof curationSchema>;

/** 只保留当前还上架的模板，避免运营配过的模板下架后首页出现空卡。 */
function onlyLive(config: HomeCuration): HomeCuration {
  const live = (id: string) => Boolean(getImageTemplate(id));
  return {
    ...config,
    lead: live(config.lead.templateId) ? config.lead : DEFAULT_HOME_CURATION.lead,
    templateIds: config.templateIds.filter(live),
  };
}

export async function getHomeCuration(): Promise<HomeCuration & { version: number }> {
  const rows = await (await getDatabase()).query<{ config: unknown; version: number }>("SELECT config,version FROM home_curation WHERE id='default'");
  const parsed = rows[0] ? curationSchema.safeParse(typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config) : undefined;
  const config = parsed?.success ? parsed.data : DEFAULT_HOME_CURATION;
  return { ...onlyLive(config), version: Number(rows[0]?.version || 0) };
}

export async function updateHomeCuration(actorId: string, input: unknown, reason: string) {
  const config = curationSchema.parse(input);
  const missing = [config.lead.templateId, ...config.templateIds].filter((id) => !getImageTemplate(id));
  if (missing.length) throw new AppError("HOME_CURATION_TEMPLATE_UNAVAILABLE", `这些模板未上架：${missing.join("、")}`, 422);
  const database = await getDatabase();
  const before = await getHomeCuration();
  const rows = await database.query<{ version: number }>(
    "INSERT INTO home_curation (id,config,version,updated_by,updated_at) VALUES ('default',$1::jsonb,1,$2,now()) ON CONFLICT (id) DO UPDATE SET config=$1::jsonb,version=home_curation.version+1,updated_by=$2,updated_at=now() RETURNING version",
    [JSON.stringify(config), actorId],
  );
  await recordAdminAudit({ actorId, action: "home_curation.update", targetType: "home_curation", targetId: "default", reason, before, after: config });
  return { ...config, version: Number(rows[0]?.version || 1) };
}
