import { NextResponse } from "next/server";
import { z } from "zod";

import { approveUploads, removeUpload, UPLOAD_KINDS } from "@/server/admin/uploads";
import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";

const item = z.object({ kind: z.enum(UPLOAD_KINDS), id: z.string().uuid() });
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), items: z.array(item).min(1).max(100), reason: z.string().max(200).optional() }),
  z.object({ action: z.literal("remove"), kind: z.enum(UPLOAD_KINDS), id: z.string().uuid(), reason: z.string().trim().min(2).max(200), suspend: z.boolean().default(false) }),
]);

/** 图片审核的写入口：批量通过 / 移除（可同时封禁上传者）。 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const actorId = await requireUserId(request);
    assertAdmin(actorId);
    const input = inputSchema.parse(await request.json());
    const data = input.action === "approve" ? await approveUploads(actorId, input.items) : await removeUpload(actorId, input);
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error);
  }
}
