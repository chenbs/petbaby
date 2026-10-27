import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createDirectLinks, directLinksSchema } from "@/server/media/direct-links";
import { enforceRateLimit } from "@/server/risk/controls";

/** 批量换取图片的 COS 预签名直连地址（见 server/media/direct-links.ts）。只读，但带列表体，所以用 POST。 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await enforceRateLimit("media-links:user", userId, 240, 60);
    const data = await createDirectLinks(userId, directLinksSchema.parse(await request.json()));
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeError(error);
  }
}
