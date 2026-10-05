import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { getRecordAttachmentObject } from "@/server/daily-log-service";
import { routeError } from "@/server/errors";

/** 记录附图只给本人看，`no-store`：撤销或删除后不能从缓存里再读到。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const object = await getRecordAttachmentObject(await requireUserId(request), z.string().uuid().parse(id));
    return new Response(Buffer.from(object.body), {
      headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeError(error);
  }
}
