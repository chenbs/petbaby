import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { getSharedWork } from "@/server/platform-service";

/*
 * 公开分享的作品（JSON）。小程序分享落地页 pages/share 用它渲染，好友无需登录。
 *
 * 原先小程序的分享卡直接指向 /pages/work/work?id=，而作品接口按所有者校验，
 * 好友打开只会看到「作品暂时无法打开」。getSharedWork 已做字段白名单（不含对象键、
 * 用户 ID 和私人档案），媒体地址也改写成 /api/share/{token}/media/* 公开出口。
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const code = new URL(request.url).searchParams.get("code") || undefined;
    const work = await getSharedWork(token, code);
    return NextResponse.json({
      data: {
        id: work.id,
        title: work.title,
        subtitle: work.subtitle,
        pluginId: work.pluginId,
        pluginName: work.plugin.name,
        pluginCategory: work.plugin.category,
        assetKind: work.assetKind,
        pet: { name: work.pet.name, species: work.pet.species },
        coverUrl: work.photo.url,
        outputUrl: work.outputUrl,
        aiGenerated: work.aiGenerated,
        aiNotice: work.aiNotice,
        createdAt: work.createdAt,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
