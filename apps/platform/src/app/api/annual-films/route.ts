import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";
import { createAnnualFilm } from "@/server/video/annual-film";

const bodySchema = z.object({
  year: z.number().int().min(2000).max(2100),
  /** 总时长三档，见 domain/video-duration.ts */
  durationSeconds: z.union([z.literal(10), z.literal(20), z.literal(30)]).optional(),
});

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    /*
     * 叙事视频是四段 filtergraph，比普通短片重得多，而队列并发是 1。
     * 限得比上传严：一分钟 3 条足够试三个时长档，再多只会把队列堵住、
     * 连带拖慢图文任务。
     */
    await Promise.all([
      enforceRateLimit("annual-film:user", userId, 3, 60),
      enforceRateLimit("annual-film:ip", clientAddress(request), 10, 60),
    ]);
    const data = bodySchema.parse(await request.json());
    return NextResponse.json({ data: await createAnnualFilm(userId, data) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
