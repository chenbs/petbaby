import { NextResponse } from "next/server";

import type { PluginManifest } from "@/domain/models";
import { listRuntimePlugins, resolveManifestTone } from "@/plugins/runtime";

/**
 * 样例图补全绝对域名。
 *
 * manifest 里存的是站内相对路径（见 runtime.ts 的 samples schema），Web 端直接用没问题；
 * 但小程序的 `<image src>` 遇到以 / 开头的值会当成主包内的本地文件路径去找，必然裂图，
 * 所以这条出口必须给绝对地址。
 *
 * 域名复用既有的 PUBLIC_APP_URL，不再新增变量：它已被 deploy/scripts/preflight.sh 列为
 * 必填并校验 HTTPS，另起一个 PUBLIC_BASE_URL 只会多一个运维可能漏配的开关。
 * 未配置时（本地联调）按请求来源推导。
 */
function absolutize(manifest: PluginManifest, origin: string): PluginManifest {
  const samples = manifest.samples;
  if (!samples) return manifest;
  const toAbsolute = (value: string) => (value.startsWith("/") ? `${origin}${value}` : value);
  return {
    ...manifest,
    samples: {
      ...(samples.heroUrl ? { heroUrl: toAbsolute(samples.heroUrl) } : {}),
      ...(samples.thumbUrls ? { thumbUrls: samples.thumbUrls.map(toAbsolute) } : {}),
      ...(samples.styleUrls
        ? { styleUrls: Object.fromEntries(Object.entries(samples.styleUrls).map(([style, url]) => [style, toAbsolute(url)])) }
        : {}),
    },
  };
}

export async function GET(request: Request) {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  const origin = configured || new URL(request.url).origin;
  const plugins = await listRuntimePlugins();
  /*
   * 按所选宠物的生命阶段解析调性（改造方案 C4）。
   *
   * 不传 petId 时给 active 文案 —— 首页在用户还没选宠物时就要渲染卡片，
   * 这时不能因为拿不到生命阶段就报错或漏卡。
   */
  const lifeStage = new URL(request.url).searchParams.get("lifeStage") || undefined;
  return NextResponse.json({
    data: plugins
      .filter((plugin) => plugin.status === "live")
      .map((plugin) => absolutize(resolveManifestTone(plugin, lifeStage), origin)),
  });
}
