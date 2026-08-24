import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getDeliveryPricing } from "@/server/platform-service";

const idSchema = z.string().uuid();
const pluginSchema = z.string().min(1).max(80);

/**
 * 交付物定价说明（改造项 L3）。**制作前就能看到**：
 * 17 号文 3.5 自己的判据是「档位必须在制作前可见，不能生成完才告价 —— 那是诱导」。
 *
 * 只读，不建订单、不占额度 —— 端上可以在选照片阶段随时调。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const pluginId = new URL(request.url).searchParams.get("pluginId");
    return NextResponse.json({
      data: await getDeliveryPricing(await requireUserId(request), idSchema.parse(id), pluginSchema.parse(pluginId)),
    });
  } catch (error) { return routeError(error); }
}
