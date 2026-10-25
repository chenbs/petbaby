import { z } from "zod";

import { getUploadImage, UPLOAD_KINDS } from "@/server/admin/uploads";
import { assertAdmin } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";

/** 审核用的图片读取（仅管理员）。默认缩略图，?full=1 给原图；私有内容一律 no-store。 */
export async function GET(request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  try {
    assertAdmin(await requireUserId(request));
    const { kind, id } = await context.params;
    const full = new URL(request.url).searchParams.get("full") === "1";
    const image = await getUploadImage(z.enum(UPLOAD_KINDS).parse(kind), z.string().uuid().parse(id), full);
    return new Response(new Uint8Array(image.body), {
      headers: { "Content-Type": image.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return routeError(error);
  }
}
