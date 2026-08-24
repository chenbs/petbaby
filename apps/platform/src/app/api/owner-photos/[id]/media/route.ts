import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getOwnerPhotoObject } from "@/server/owner-photo-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const object = await getOwnerPhotoObject(await requireUserId(request), z.string().uuid().parse(id));
    return new Response(Buffer.from(object.body), {
      headers: { "Content-Type": object.contentType, "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    return routeError(error);
  }
}
