import { NextResponse, after } from "next/server";
import sharp from "sharp";

import { getOptionalUserId } from "@/server/auth/session";
import { routeError, AppError } from "@/server/errors";
import { storeDisplayCopy } from "@/server/media/direct-links";
import { canDisplayResize, displayImage } from "@/server/media/display-image";
import { canReadMediaKey } from "@/server/media/media-access";
import { objectStorage } from "@/server/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  try {
    const userId = await getOptionalUserId(request);
    const { key: segments } = await context.params;
    const key = segments.join("/");
    if (!userId || !(await canReadMediaKey(userId, key))) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const params = new URL(request.url).searchParams;
    // display=1：小程序列表与详情展示用的小 JPEG（见 server/media/display-image.ts）；保存原图走各自的下载出口
    const display = params.get("display") === "1" && canDisplayResize(object.contentType);
    const raster = !display && params.get("format") === "png" && object.contentType === "image/svg+xml";
    const body = display ? await displayImage(key, object) : raster ? await sharp(Buffer.from(object.body)).png().toBuffer() : Buffer.from(object.body);
    // 回落到这条路时顺手把小图落进对象存储，下次就能预签名直连（见 media/direct-links.ts）
    if (display && objectStorage.signedUrl) after(() => storeDisplayCopy(key, body).catch(() => undefined));
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": display ? "image/jpeg" : raster ? "image/png" : object.contentType,
        "Cache-Control": "private, no-store",
        "Vary": "Cookie, Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
